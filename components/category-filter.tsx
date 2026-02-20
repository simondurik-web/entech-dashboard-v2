'use client'

const CATEGORY_OPTIONS = [
  { key: 'Roll Tech', label: 'Roll Tech', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50 hover:bg-blue-500/30', activeColor: 'bg-blue-500 text-white border-blue-500' },
  { key: 'Molding', label: 'Molding', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 hover:bg-yellow-500/30', activeColor: 'bg-yellow-500 text-white border-yellow-500' },
  { key: 'Snap Pad', label: 'Snap Pad', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-500/30', activeColor: 'bg-purple-500 text-white border-purple-500' },
]

const ALL_KEYS = CATEGORY_OPTIONS.map((c) => c.key)

interface CategoryFilterProps {
  value: string[]
  onChange: (categories: string[]) => void
}

export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  const allActive = value.length === ALL_KEYS.length || value.length === 0

  function toggleCategory(key: string) {
    if (allActive) {
      // From "all selected" → select only this one
      onChange([key])
    } else if (value.includes(key)) {
      // Deselecting — if it would leave none, go back to all
      const next = value.filter((k) => k !== key)
      onChange(next.length === 0 ? [...ALL_KEYS] : next)
    } else {
      // Adding one more
      const next = [...value, key]
      // If all are now selected, normalize to full array
      onChange(next.length === ALL_KEYS.length ? [...ALL_KEYS] : next)
    }
  }

  function toggleAll() {
    onChange([...ALL_KEYS])
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={toggleAll}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150
          ${allActive ? 'bg-slate-500 text-white border-slate-500' : 'bg-slate-500/20 text-slate-300 border-slate-500/50 hover:bg-slate-500/30'}
        `}
      >
        All
      </button>
      {CATEGORY_OPTIONS.map((cat) => {
        const isActive = allActive || value.includes(cat.key)
        const isExclusive = !allActive && value.includes(cat.key)
        return (
          <button
            key={cat.key}
            onClick={() => toggleCategory(cat.key)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150
              ${isExclusive ? cat.activeColor : allActive ? cat.color : isActive ? cat.activeColor : cat.color}
            `}
          >
            <span className={`size-2 rounded-full ${isExclusive ? 'bg-white/80' : 'bg-current opacity-60'}`} />
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}

export function filterByCategory<T extends { category?: string }>(data: T[], categories: string[]): T[] {
  if (categories.length === ALL_KEYS.length || categories.length === 0) return data
  return data.filter((item) => item.category !== undefined && categories.includes(item.category))
}

/** Default value for category filter state — all selected */
export const DEFAULT_CATEGORIES = [...ALL_KEYS]
