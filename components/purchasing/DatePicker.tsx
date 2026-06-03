'use client'

import { useState, useMemo } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

/** Parse a 'YYYY-MM-DD' string into y/m/d parts (no timezone shift). Returns
 *  null for malformed or impossible dates (e.g. 2024-02-31). */
function parseISO(v: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!match) return null
  const y = +match[1], m = +match[2] - 1, d = +match[3]
  const dt = new Date(y, m, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null
  return { y, m, d }
}
function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
}) {
  const { t, language } = useI18n()
  const locale = language === 'es' ? 'es-ES' : 'en-US'
  const [open, setOpen] = useState(false)

  const today = new Date()
  const parsed = parseISO(value)
  const [view, setView] = useState(() => ({
    y: parsed?.y ?? today.getFullYear(),
    m: parsed?.m ?? today.getMonth(),
  }))

  const monthNames = useMemo(
    () => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2020, i, 1))),
    [locale]
  )
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2023, 0, 1 + i))), // Jan 1 2023 = Sunday
    [locale]
  )
  // Window the year <select> around the CURRENTLY VIEWED year so paging past
  // the edges with the chevrons never leaves the select without a matching option.
  const years = useMemo(() => {
    const set = new Set<number>()
    for (let y = view.y - 8; y <= view.y + 4; y++) set.add(y)
    set.add(today.getFullYear())
    if (parsed) set.add(parsed.y)
    return [...set].sort((a, b) => a - b)
  }, [view.y, parsed, today])

  const firstWeekday = new Date(view.y, view.m, 1).getDay() // 0=Sun
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const display = parsed ? new Date(parsed.y, parsed.m, parsed.d).toLocaleDateString(locale) : ''
  const isToday = (d: number) => view.y === today.getFullYear() && view.m === today.getMonth() && d === today.getDate()
  const isSelected = (d: number) => parsed && parsed.y === view.y && parsed.m === view.m && parsed.d === d

  const step = (delta: number) => {
    setView((v) => {
      let m = v.m + delta, y = v.y
      if (m < 0) { m = 11; y-- }
      if (m > 11) { m = 0; y++ }
      return { y, m }
    })
  }
  const pick = (d: number) => { onChange(toISO(view.y, view.m, d)); setOpen(false) }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o && parsed) setView({ y: parsed.y, m: parsed.m }) }}>
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
            <span className={cn('truncate', !display && 'text-muted-foreground')}>
              {display || placeholder || t('purchasing.date.select')}
            </span>
          </button>
        </PopoverTrigger>
        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
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
      <PopoverContent align="start" collisionPadding={8} className="z-[60] w-auto max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3">
        <div className="mb-2 flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} className="rounded p-2 hover:bg-accent" aria-label="prev">
            <ChevronLeft className="size-4" />
          </button>
          <select
            value={view.m}
            onChange={(e) => setView((v) => ({ ...v, m: +e.target.value }))}
            className="h-8 flex-1 rounded-md border border-input bg-transparent px-1 text-sm"
          >
            {monthNames.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
          <select
            value={view.y}
            onChange={(e) => setView((v) => ({ ...v, y: +e.target.value }))}
            className="h-8 rounded-md border border-input bg-transparent px-1 text-sm"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" onClick={() => step(1)} className="rounded p-2 hover:bg-accent" aria-label="next">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {weekdays.map((w, i) => <div key={i} className="py-1 text-[11px] font-medium text-muted-foreground">{w}</div>)}
          {cells.map((d, i) => (
            <div key={i}>
              {d != null && (
                <button
                  type="button"
                  onClick={() => pick(d)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-sm hover:bg-accent',
                    isSelected(d) && 'bg-primary text-primary-foreground hover:bg-primary',
                    !isSelected(d) && isToday(d) && 'border border-primary/50'
                  )}
                >
                  {d}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between border-t pt-2">
          <button type="button" onClick={() => { const n = new Date(); onChange(toISO(n.getFullYear(), n.getMonth(), n.getDate())); setOpen(false) }} className="text-xs text-primary hover:underline">
            {t('purchasing.date.today')}
          </button>
          {value && (
            <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="text-xs text-muted-foreground hover:underline">
              {t('purchasing.date.clear')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
