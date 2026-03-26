'use client'

import { SearchX, FilterX, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  type?: 'no-results' | 'no-data' | 'filtered'
  title?: string
  description?: string
  onClearFilters?: () => void
}

export function EmptyState({ type = 'no-results', title, description, onClearFilters }: EmptyStateProps) {
  const defaults = {
    'no-results': { icon: SearchX, title: 'No results found', desc: 'Try adjusting your search or filters.' },
    'no-data': { icon: Inbox, title: 'No data yet', desc: 'Data will appear here once available.' },
    'filtered': { icon: FilterX, title: 'No matches', desc: 'No items match your current filters.' },
  }

  const config = defaults[type]
  const Icon = config.icon

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title || config.title}</h3>
      <p className="text-xs text-muted-foreground max-w-sm mb-4">{description || config.desc}</p>
      {onClearFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear all filters
        </Button>
      )}
    </div>
  )
}
