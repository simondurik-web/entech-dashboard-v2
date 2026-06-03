'use client'

import { useState, useMemo, useRef } from 'react'
import { ChevronsUpDown, Check, Plus, X, Pencil, Trash2 } from 'lucide-react'
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
  onEdit,
  onDelete,
  id,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  /** Called when the user adds a value not in the list. Should persist it. */
  onCreate?: (value: string) => Promise<void> | void
  /** Rename an existing option (persist + update list). Enables the edit icon. */
  onEdit?: (oldValue: string, newValue: string) => Promise<void> | void
  /** Delete an existing option (persist + update list). Enables the delete icon. */
  onDelete?: (value: string) => Promise<void> | void
  id?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingOpt, setEditingOpt] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const touchY = useRef<number | null>(null)
  const manageable = !!onEdit || !!onDelete

  const commitEdit = async (oldValue: string) => {
    const nv = editText.trim()
    setEditingOpt(null)
    if (!nv || nv === oldValue) return
    // Don't rename onto a value that already exists (would dupe / hit UNIQUE).
    if (options.some((o) => o !== oldValue && o.toLowerCase() === nv.toLowerCase())) return
    await onEdit?.(oldValue, nv)
  }

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
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQuery(''); setEditingOpt(null) } }}>
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
            editingOpt === o ? (
              <div key={o} className="flex items-center gap-1 px-1 py-1">
                <Input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="h-8"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(o) }
                    if (e.key === 'Escape') setEditingOpt(null)
                  }}
                />
                <button type="button" aria-label={t('ui.save')} onClick={() => commitEdit(o)} className="flex size-7 shrink-0 items-center justify-center rounded-sm text-primary hover:bg-accent"><Check className="size-4" /></button>
                <button type="button" aria-label={t('ui.cancel')} onClick={() => setEditingOpt(null)} className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"><X className="size-4" /></button>
              </div>
            ) : (
              <div key={o} className="flex items-center rounded-sm hover:bg-accent">
                <button
                  type="button"
                  onClick={() => select(o)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
                >
                  <Check className={cn('size-3.5 shrink-0', o === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o}</span>
                </button>
                {manageable && (
                  <span className="flex shrink-0 items-center gap-0.5 pr-1">
                    {onEdit && (
                      <button type="button" aria-label={t('ui.edit')} onClick={() => { setEditingOpt(o); setEditText(o) }} className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground">
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" aria-label={t('ui.delete')} onClick={async () => { if (window.confirm(t('purchasing.combobox.confirmDelete').replace('{v}', o))) await onDelete(o) }} className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </div>
            )
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
