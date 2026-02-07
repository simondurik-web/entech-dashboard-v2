'use client'

import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ColumnToggleProps {
  columns: { key: string; label: string }[]
  hiddenColumns: Set<string>
  onToggle: (key: string) => void
}

export function ColumnToggle({ columns, hiddenColumns, onToggle }: ColumnToggleProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="size-4" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-0">
        <div className="p-3 space-y-1">
          <p className="text-sm font-medium mb-2">Toggle columns</p>
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 px-1 py-0.5 rounded text-sm hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={!hiddenColumns.has(col.key)}
                onCheckedChange={() => onToggle(col.key)}
              />
              <span>{col.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
