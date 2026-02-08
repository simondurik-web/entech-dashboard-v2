'use client'

import { useState, useMemo } from 'react'
import { Filter, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ColumnFilterProps {
  columnKey: string
  data: unknown[]
  activeFilter: Set<string> | undefined
  onApply: (key: string, values: Set<string>) => void
  onClear: (key: string) => void
  onHide?: (key: string) => void
}

export function ColumnFilter({
  columnKey,
  data,
  activeFilter,
  onApply,
  onClear,
  onHide,
}: ColumnFilterProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const uniqueValues = useMemo(() => {
    const values = new Set<string>()
    for (const val of data) {
      const str = String(val ?? '')
      if (str) values.add(str)
    }
    return [...values].sort()
  }, [data])

  const filteredValues = useMemo(() => {
    if (!search.trim()) return uniqueValues
    const q = search.toLowerCase()
    return uniqueValues.filter((v) => v.toLowerCase().includes(q))
  }, [uniqueValues, search])

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      // Initialize selected state from active filter
      setSelected(new Set(activeFilter ?? []))
      setSearch('')
    }
    setOpen(isOpen)
  }

  const toggleValue = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set(filteredValues))
  const deselectAll = () => setSelected(new Set())

  const handleApply = () => {
    onApply(columnKey, selected)
    setOpen(false)
  }

  const handleClear = () => {
    onClear(columnKey)
    setOpen(false)
  }

  const isActive = activeFilter && activeFilter.size > 0

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className={isActive ? 'text-primary' : 'text-muted-foreground'}
        >
          <Filter className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-3 space-y-3">
          <Input
            placeholder="Search values..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />

          <div className="flex gap-2">
            <Button variant="ghost" size="xs" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="ghost" size="xs" onClick={deselectAll}>
              Deselect All
            </Button>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredValues.map((value) => (
              <label
                key={value}
                className="flex items-center gap-2 px-1 py-0.5 rounded text-sm hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(value)}
                  onCheckedChange={() => toggleValue(value)}
                />
                <span className="truncate">{value}</span>
              </label>
            ))}
            {filteredValues.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No values found
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-1 border-t">
            <Button size="sm" className="flex-1" onClick={handleApply}>
              Apply
            </Button>
            {onHide && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onHide(columnKey)
                  setOpen(false)
                }}
                title="Hide this column"
              >
                <EyeOff className="size-3.5 mr-1" />
                Hide
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
