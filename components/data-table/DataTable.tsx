'use client'

import { ArrowUp, ArrowDown, ArrowUpDown, Search, X, Trash2, RotateCcw, Bookmark } from 'lucide-react'
import { Fragment, useState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ColumnDef, UseDataTableReturn } from '@/lib/use-data-table'
import { ColumnFilter } from './ColumnFilter'
import { ColumnToggle } from './ColumnToggle'
import { ExportMenu } from './ExportMenu'

export interface DataTableProps<T extends Record<string, unknown>> {
  table: UseDataTableReturn<T>
  /** All raw data for column filter value extraction */
  data: T[]
  /** Render a mobile card for each row (shown below md breakpoint) */
  renderCard?: (row: T, index: number) => React.ReactNode
  /** Optional className for the card in mobile view when renderCard is not provided */
  cardClassName?: (row: T) => string
  /** Export filename (without extension) */
  exportFilename?: string
  /** Noun for the count display, e.g. "order" -> "5 orders" */
  noun?: string
  /** Optional stable key for row/cell expansion state */
  getRowKey?: (row: T, index: number) => string
  /** Current expanded row key */
  expandedRowKey?: string | null
  /** Called when a desktop table row is clicked */
  onRowClick?: (row: T, index: number) => void
  /** Render expandable content for desktop table/mobile cards */
  renderExpandedContent?: (row: T, index: number) => React.ReactNode
  /** Optional className for each table row (e.g. urgent highlighting) */
  rowClassName?: (row: T) => string
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
  getRowKey,
  expandedRowKey,
  onRowClick,
  renderExpandedContent,
  rowClassName,
}: DataTableProps<T>) {
  const { t } = useI18n()
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
    moveColumn,
    resetView,
  } = table

  const hasActiveFilters = filters.size > 0 || searchTerm.trim() !== ''

  // Drag-and-drop column reordering state
  const [dragColKey, setDragColKey] = useState<string | null>(null)
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null)
  const dragSourceIndex = useRef<number | null>(null)

  const handleDragStart = (key: string, index: number) => {
    setDragColKey(key)
    dragSourceIndex.current = index
  }

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault()
    setDragOverColKey(key)
  }

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault()
    if (dragColKey && dragColKey !== targetKey) {
      // Find indices in the full column order (not just visible)
      const allCols = columns.map((c) => c.key)
      const fromIdx = allCols.indexOf(dragColKey)
      const toIdx = allCols.indexOf(targetKey)
      if (fromIdx >= 0 && toIdx >= 0) {
        moveColumn(fromIdx, toIdx)
      }
    }
    setDragColKey(null)
    setDragOverColKey(null)
    dragSourceIndex.current = null
  }

  const handleDragEnd = () => {
    setDragColKey(null)
    setDragOverColKey(null)
    dragSourceIndex.current = null
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t('ui.search')}
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
            <Button variant="destructive" size="sm" onClick={clearAllFilters}>
              <Trash2 className="size-3.5 mr-1.5" />
              {t('ui.clearFilters')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={resetView}
            title={t('ui.reset')}
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">{t('ui.reset')}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Custom Views — coming soon with Google login"
            className="opacity-50 cursor-not-allowed"
          >
            <Bookmark className="size-3.5" />
            <span className="hidden sm:inline">{t('ui.views')}</span>
            <span className="hidden lg:inline text-[10px] text-muted-foreground ml-1">{t('ui.viewsSoon')}</span>
          </Button>
          <ColumnToggle
            columns={columns}
            hiddenColumns={hiddenColumns}
            onToggle={toggleColumn}
          />
          <ExportMenu
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

      {/* Desktop table (sm+ = iPad & Desktop) */}
      <div className="hidden sm:block rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {visibleColumns.map((col, colIdx) => (
                <th
                  key={col.key}
                  className={cn(
                    'text-left font-medium px-3 py-2 select-none',
                    dragOverColKey === col.key && dragColKey !== col.key && 'bg-primary/10 border-l-2 border-l-primary'
                  )}
                  draggable
                  onDragStart={() => handleDragStart(col.key, colIdx)}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                  onDrop={(e) => handleDrop(e, col.key)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex items-center gap-1">
                    {/* Drag handle */}
                    <span className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground mr-0.5" title="Drag to reorder">⠿</span>
                    {col.sortable !== false ? (
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
                    {col.filterable !== false && (
                      <ColumnFilter
                        columnKey={col.key}
                        data={data.map((row) => row[col.key])}
                        activeFilter={filters.get(col.key)}
                        onApply={setFilter}
                        onClear={clearFilter}
                        onHide={toggleColumn}
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedData.map((row, i) => {
              const rowKey = getRowKey?.(row, i) ?? String(i)
              const isExpanded = expandedRowKey === rowKey
              const isClickable = !!onRowClick

              return (
                <Fragment key={rowKey}>
                  <tr
                    className={cn(
                      'border-b transition-colors',
                      !isExpanded && 'hover:bg-muted/30',
                      isClickable && 'cursor-pointer',
                      rowClassName?.(row)
                    )}
                    onClick={isClickable ? () => onRowClick(row, i) : undefined}
                  >
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        {col.render
                          ? col.render(row[col.key], row)
                          : formatCellValue(row[col.key])}
                      </td>
                    ))}
                  </tr>
                  {renderExpandedContent && (
                    <tr className={cn(isExpanded && 'border-b')}>
                      <td colSpan={visibleColumns.length} className="p-0">
                        <div
                          className={cn(
                            'grid transition-all duration-300 ease-out',
                            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                          )}
                        >
                          <div className="overflow-hidden">
                            {isExpanded ? (
                              <div className="bg-muted/25 px-3 py-3">
                                {renderExpandedContent(row, i)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
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

      {/* Mobile cards (iPhone only, <sm/640px) */}
      <div className="sm:hidden space-y-3">
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
