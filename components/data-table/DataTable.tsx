'use client'

import { ArrowUp, ArrowDown, ArrowUpDown, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ColumnDef, UseDataTableReturn } from '@/lib/use-data-table'
import { ColumnFilter } from './ColumnFilter'
import { ColumnToggle } from './ColumnToggle'
import { ExportCSV } from './ExportCSV'

export interface DataTableProps<T extends Record<string, unknown>> {
  table: UseDataTableReturn<T>
  /** All raw data for column filter value extraction */
  data: T[]
  /** Render a mobile card for each row (shown below md breakpoint) */
  renderCard?: (row: T, index: number) => React.ReactNode
  /** Optional className for the card in mobile view when renderCard is not provided */
  cardClassName?: (row: T) => string
  /** CSV export filename */
  exportFilename?: string
  /** Noun for the count display, e.g. "order" -> "5 orders" */
  noun?: string
}

function SortIcon({ columnKey, sortKey, sortDir }: {
  columnKey: string
  sortKey: string | null
  sortDir: 'asc' | 'desc' | null
}) {
  if (sortKey !== columnKey || !sortDir) {
    return <ArrowUpDown className="size-3 text-muted-foreground" />
  }
  return sortDir === 'asc'
    ? <ArrowUp className="size-3" />
    : <ArrowDown className="size-3" />
}

export function DataTable<T extends Record<string, unknown>>({
  table,
  data,
  renderCard,
  cardClassName,
  exportFilename,
  noun = 'row',
}: DataTableProps<T>) {
  const {
    visibleColumns,
    columns,
    processedData,
    sortKey,
    sortDir,
    filters,
    hiddenColumns,
    searchTerm,
    toggleSort,
    setFilter,
    clearFilter,
    clearAllFilters,
    toggleColumn,
    setSearch,
  } = table

  const hasActiveFilters = filters.size > 0 || searchTerm.trim() !== ''

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
          {searchTerm && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear filters
            </Button>
          )}
          <ColumnToggle
            columns={columns}
            hiddenColumns={hiddenColumns}
            onToggle={toggleColumn}
          />
          <ExportCSV
            data={processedData}
            columns={visibleColumns}
            filename={exportFilename}
          />
        </div>
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        {processedData.length} {noun}{processedData.length !== 1 ? 's' : ''}
        {hasActiveFilters && ` (filtered from ${data.length})`}
      </p>

      {/* Desktop table (md+) */}
      <div className="hidden md:block rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {visibleColumns.map((col) => (
                <th key={col.key} className="text-left font-medium px-3 py-2">
                  <div className="flex items-center gap-1">
                    {col.sortable ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {col.label}
                        <SortIcon
                          columnKey={col.key}
                          sortKey={sortKey}
                          sortDir={sortDir}
                        />
                      </button>
                    ) : (
                      <span>{col.label}</span>
                    )}
                    {col.filterable && (
                      <ColumnFilter
                        columnKey={col.key}
                        data={data.map((row) => row[col.key])}
                        activeFilter={filters.get(col.key)}
                        onApply={setFilter}
                        onClear={clearFilter}
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedData.map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-3 py-2">
                    {col.render
                      ? col.render(row[col.key], row)
                      : formatCellValue(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
            {processedData.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="text-center text-muted-foreground py-10"
                >
                  No {noun}s found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (<md) */}
      <div className="md:hidden space-y-3">
        {processedData.map((row, i) =>
          renderCard ? (
            renderCard(row, i)
          ) : (
            <DefaultCard
              key={i}
              row={row}
              columns={visibleColumns}
              className={cardClassName?.(row)}
            />
          )
        )}
        {processedData.length === 0 && (
          <p className="text-center text-muted-foreground py-10">
            No {noun}s found
          </p>
        )}
      </div>
    </div>
  )
}

function DefaultCard<T extends Record<string, unknown>>({
  row,
  columns,
  className,
}: {
  row: T
  columns: ColumnDef<T>[]
  className?: string
}) {
  const [first, ...rest] = columns
  return (
    <Card className={cn('border-l-4', className)}>
      <CardContent className="pt-4 pb-3 px-4 space-y-2">
        {first && (
          <p className="font-semibold">
            {first.render
              ? first.render(row[first.key], row)
              : formatCellValue(row[first.key])}
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {rest.map((col) => (
            <div key={col.key}>
              <span className="text-muted-foreground">{col.label}</span>
              <p className="font-medium">
                {col.render
                  ? col.render(row[col.key], row)
                  : formatCellValue(row[col.key])}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}
