'use client'

import { useState, useMemo, useRef } from 'react'
import { ChevronsUpDown, Check, Plus, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  onCreate,
  id,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  /** Called when the user adds a value not in the list. Should persist it. */
  onCreate?: (value: string) => Promise<void> | void
  id?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const touchY = useRef<number | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, query])

  const exactMatch = useMemo(
    () => options.some((o) => o.toLowerCase() === query.trim().toLowerCase()),
    [options, query]
  )
  const canCreate = !!onCreate && query.trim() !== '' && !exactMatch

  const select = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const handleCreate = async () => {
    const v = query.trim()
    if (!v || creating) return
    setCreating(true)
    try {
      await onCreate?.(v)
      select(v)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <div className="relative mt-1">
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              'flex h-9 w-full items-center rounded-md border border-input bg-transparent pl-3 text-left text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              value ? 'pr-14' : 'pr-9'
            )}
          >
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value || placeholder || t('purchasing.combobox.select')}
            </span>
          </button>
        </PopoverTrigger>
        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        {value && (
          <button
            type="button"
            aria-label={t('purchasing.date.clear')}
            onClick={() => onChange('')}
            className="absolute right-7 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="z-[60] w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0"
        onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus() }}
      >
        <div className="border-b p-1.5">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('purchasing.combobox.searchOrAdd')}
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) { e.preventDefault(); handleCreate() }
            }}
          />
        </div>
        <div
          className="max-h-56 overflow-y-auto overscroll-contain p-1"
          onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY }}
          onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null }}
          onTouchMove={(e) => {
            if (touchY.current == null) return
            const y = e.touches[0]?.clientY ?? touchY.current
            e.currentTarget.scrollTop += touchY.current - y
            touchY.current = y
          }}
          onTouchEnd={() => { touchY.current = null }}
        >
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => select(o)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
            >
              <Check className={cn('size-3.5 shrink-0', o === value ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{o}</span>
            </button>
          ))}
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t('purchasing.combobox.noResults')}</p>
          )}
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm text-primary hover:bg-accent disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            {t('purchasing.combobox.add')} &quot;{query.trim()}&quot;
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
