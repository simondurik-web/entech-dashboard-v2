'use client'

import type { JSX } from 'react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { visibleCategoryKeys, type CategoryKey } from '@/lib/category'

// Classification logic lives in lib/category.ts (pure, no React). Re-exported here
// so the many pages that already import from this module keep working unchanged.
export {
  CATEGORY_KEYS,
  DEFAULT_CATEGORIES,
  classifyCategory,
  filterByCategory,
  visibleCategoryKeys,
  type CategoryKey,
} from '@/lib/category'

const CATEGORY_OPTIONS: Record<CategoryKey, {
  i18nKey: string
  emoji: string
  color: string
  activeColor: string
}> = {
  rolltech: {
    i18nKey: 'category.rollTech',
    emoji: '🔵',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/50 hover:bg-blue-500/30',
    activeColor: 'bg-blue-500 text-white border-blue-500',
  },
  molding: {
    i18nKey: 'category.molding',
    emoji: '🟡',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 hover:bg-yellow-500/30',
    activeColor: 'bg-yellow-500 text-white border-yellow-500',
  },
  snappad: {
    i18nKey: 'category.snappad',
    emoji: '🟣',
    color: 'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-500/30',
    activeColor: 'bg-purple-500 text-white border-purple-500',
  },
  technoflex: {
    i18nKey: 'category.technoflex',
    emoji: '🟠',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/50 hover:bg-orange-500/30',
    activeColor: 'bg-orange-500 text-white border-orange-500',
  },
}

interface CategoryFilterProps {
  value: readonly CategoryKey[]
  onChange: (categories: CategoryKey[]) => void
  /** Set false where rows have no `customer` (material-requirements). Default true. */
  showTechnoflex?: boolean
  /** Extra classes on the wrapper. */
  className?: string
}

export function CategoryFilter({
  value,
  onChange,
  showTechnoflex = true,
  className,
}: CategoryFilterProps): JSX.Element {
  const { t } = useI18n()
  const visibleKeys = visibleCategoryKeys(showTechnoflex)
  const allActive = value.length === 0 || value.length === visibleKeys.length

  function toggleCategory(key: CategoryKey) {
    if (allActive) {
      onChange([key])
    } else if (value.includes(key)) {
      const next = value.filter((selected) => selected !== key)
      onChange(next.length === 0 ? [...visibleKeys] : next)
    } else {
      const next = [...value, key]
      onChange(next.length === visibleKeys.length ? [...visibleKeys] : next)
    }
  }

  function toggleAll() {
    onChange([...visibleKeys])
  }

  return (
    // cn() → twMerge: every caller passes its own `gap-*`/layout classes, and raw
    // concatenation would leave `gap-1.5 gap-2` both applied, letting stylesheet
    // order decide the spacing. twMerge drops the losing one deterministically.
    <div className={cn('flex items-center gap-1.5', className)}>
      <button
        type="button"
        aria-pressed={allActive}
        onClick={toggleAll}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap transition-all duration-150
          ${allActive ? 'bg-slate-500 text-white border-slate-500' : 'bg-slate-500/20 text-slate-300 border-slate-500/50 hover:bg-slate-500/30'}
        `}
      >
        {t('category.all')}
      </button>
      {visibleKeys.map((key) => {
        const option = CATEGORY_OPTIONS[key]
        const active = !allActive && value.includes(key)
        return (
          <button
            type="button"
            aria-pressed={active}
            key={key}
            onClick={() => toggleCategory(key)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap transition-all duration-150
              ${active ? option.activeColor : option.color}
            `}
          >
            <span aria-hidden="true">{option.emoji}</span>
            {t(option.i18nKey)}
          </button>
        )
      })}
    </div>
  )
}
