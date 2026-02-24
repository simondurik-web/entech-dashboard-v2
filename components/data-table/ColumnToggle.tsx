'use client'

import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ColumnToggleProps {
  columns: { key: string; label: string; defaultHidden?: boolean }[]
  hiddenColumns: Set<string>
  onToggle: (key: string) => void
}

export function ColumnToggle({ columns, hiddenColumns, onToggle }: ColumnToggleProps) {
  const defaultCols = columns.filter((c) => !c.defaultHidden)
  const extraCols = columns.filter((c) => c.defaultHidden)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="size-4" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0 max-h-[70vh] overflow-y-auto">
        <div className="p-3 space-y-1">
          <p className="text-sm font-medium mb-2">Toggle columns</p>
          {defaultCols.map((col) => (
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
          {extraCols.length > 0 && (
            <>
              <div className="border-t border-border/50 my-2" />
              <p className="text-xs text-muted-foreground font-medium mb-1">Additional columns</p>
              {extraCols.map((col) => (
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
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
