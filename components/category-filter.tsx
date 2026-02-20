'use client'

import { useState } from 'react'

const CATEGORIES = [
  { key: 'all', label: 'All', color: 'bg-slate-500/20 text-slate-300 border-slate-500/50 hover:bg-slate-500/30', activeColor: 'bg-slate-500 text-white border-slate-500' },
  { key: 'Roll Tech', label: 'Roll Tech', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50 hover:bg-blue-500/30', activeColor: 'bg-blue-500 text-white border-blue-500' },
  { key: 'Molding', label: 'Molding', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 hover:bg-yellow-500/30', activeColor: 'bg-yellow-500 text-white border-yellow-500' },
  { key: 'Snap Pad', label: 'Snap Pad', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-500/30', activeColor: 'bg-purple-500 text-white border-purple-500' },
]

interface CategoryFilterProps {
  value: string
  onChange: (category: string) => void
}

export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-1.5">
      {CATEGORIES.map((cat) => {
        const isActive = value === cat.key
        return (
          <button
            key={cat.key}
            onClick={() => onChange(cat.key)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150
              ${isActive ? cat.activeColor : cat.color}
            `}
          >
            {cat.key !== 'all' && (
              <span className={`size-2 rounded-full ${isActive ? 'bg-white/80' : 'bg-current opacity-60'}`} />
            )}
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}

export function filterByCategory<T extends { category?: string }>(data: T[], category: string): T[] {
  if (category === 'all') return data
  return data.filter((item) => item.category === category)
}
