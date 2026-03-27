'use client'

import { cn } from '@/lib/utils'

const RANGES = [
  { id: 'last3m', label: 'Last 3M' },
  { id: 'last6m', label: 'Last 6M' },
  { id: 'ytd', label: 'YTD' },
  { id: 'last12m', label: 'Last 12M' },
  { id: 'all', label: 'All Time' },
] as const

export type DateRangeId = (typeof RANGES)[number]['id']

interface Props {
  value: DateRangeId
  onChange: (value: DateRangeId) => void
}

export function DateRangeSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Range:</span>
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onChange(r.id)}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150',
            value === r.id
              ? 'bg-primary/20 text-primary border-primary/40'
              : 'bg-white/[0.02] text-muted-foreground border-white/[0.08] hover:border-white/[0.15] hover:text-foreground'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
