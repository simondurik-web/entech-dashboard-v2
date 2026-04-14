'use client'

import { ArrowUp, ArrowDown, ArrowUpDown, Search, X, Trash2, RotateCcw } from 'lucide-react'
import { Fragment, isValidElement, Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ColumnDef, DataTableViewConfig, UseDataTableReturn } from '@/lib/use-data-table'
import { exportToCSV, exportToExcel } from '@/lib/export-utils'
import { EmptyState } from '@/components/ui/empty-state'
import { ColumnFilter } from './ColumnFilter'
import { ColumnToggle } from './ColumnToggle'
import { ExportMenu } from './ExportMenu'
import { ViewsMenu } from './ViewsMenu'

export interface DataTableProps<T extends Record<string, unknown>> {
  table: UseDataTableReturn<T>
  data: T[]
  renderCard?: (row: T, index: number) => React.ReactNode
  cardClassName?: (row: T) => string
  exportFilename?: string
  noun?: string
  getRowKey?: (row: T, index: number) => string
  expandedRowKey?: string | null
  onRowClick?: (row: T, index: number) => void
  renderExpandedContent?: (row: T, index: number) => React.ReactNode
  rowClassName?: (row: T) => string
  /** Page key for saved views — pass to enable Custom Views button */
  page?: string
  /** Initial view config to apply (e.g. from URL query param) */
  initialView?: DataTableViewConfig | null
  /** Auto-export format — triggers download once data is ready */
  autoExport?: 'csv' | 'xlsx' | null
  /** Custom Excel export function — overrides default exportToExcel */
  onExcelExport?: (data: T[], columns: { key: keyof T & string; label: string }[], filename: string) => Promise<void>
  /** Disable framer-motion layout animations (recommended for large data sets or when browser extensions may interfere) */
  disableAnimation?: boolean
}

/** Per-row error boundary so one bad row doesn't crash the whole table */
class RowErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return <tr><td colSpan={99} className="px-3 py-2 text-xs text-destructive">Error rendering row</td></tr>
    }
    return this.props.children
  }
}

class CardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return <Card className="border-l-4 border-l-red-500"><CardContent className="p-4"><p className="text-red-500 text-sm">Error rendering record</p></CardContent></Card>
    }
    return this.props.children
  }
}

function SortIcon({ columnKey, sortKey, sortDir }: {
  columnKey: string
  sortKey: string | null
  sortDir: 'asc' | 'desc' | null
}) {
  if (sortKey !== columnKey || !sortDir) return <ArrowUpDown className="size-3 text-muted-foreground" />
  return sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
}

function TableRow<T extends Record<string, unknown>>({ row, index: i, visibleColumns, disableAnimation, expandedRowKey, onRowClick, renderExpandedContent, rowClassName, getRowKey }: {
  row: T
  index: number
  visibleColumns: ColumnDef<T>[]
  disableAnimation: boolean
  expandedRowKey?: string | null
  onRowClick?: (row: T, index: number) => void
  renderExpandedContent?: (row: T, index: number) => ReactNode
  rowClassName?: (row: T) => string
  getRowKey?: (row: T, index: number) => string
}) {
  const rowKey = getRowKey?.(row, i) ?? String(i)
  const isExpanded = expandedRowKey === rowKey
  const isClickable = !!onRowClick
  const useLayout = !disableAnimation && i < 50
  const RowTag = useLayout ? motion.tr : 'tr'
  const layoutProps = useLayout ? { layout: true as const, transition: { duration: 0.2 } } : {}
  return (
    <Fragment>
      <RowTag
        {...layoutProps}
        className={cn('border-b table-row-hover', isClickable && 'cursor-pointer', rowClassName?.(row))}
        style={i < 25 ? { animation: `fadeSlideIn 300ms ease-out ${i * 30}ms both` } : undefined}
        onClick={isClickable ? () => onRowClick(row, i) : undefined}
      >
        {visibleColumns.map((col) => {
          try {
            const cellValue = col.render ? safeCellRender(col.render(row[col.key], row)) : formatCellValue(row[col.key])
            return <td key={col.key} className="px-3 py-2">{cellValue}</td>
          } catch (err) {
            console.error(`Error rendering column "${col.key}":`, err, 'row:', row, 'value:', row[col.key])
            return <td key={col.key} className="px-3 py-2 text-destructive">Error</td>
          }
        })}
      </RowTag>
      {renderExpandedContent && (
        <AnimatePresence>
          {isExpanded && (
            <motion.tr
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="border-b"
            >
              <td colSpan={visibleColumns.length} className="p-0">
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="overflow-hidden"
                >
                  <div className="bg-muted/25 px-3 py-3">
                    {renderExpandedContent(row, i)}
                  </div>
                </motion.div>
              </td>
            </motion.tr>
          )}
        </AnimatePresence>
      )}
    </Fragment>
  )
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
  page,
  initialView,
  autoExport,
  onExcelExport,
  disableAnimation = false,
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
    applyView,
    getViewConfig,
  } = table

  // Apply initial view config once on mount
  const appliedInitial = useRef(false)
  useEffect(() => {
    if (initialView && !appliedInitial.current) {
      appliedInitial.current = true
      applyView(initialView)
    }
  }, [initialView, applyView])

  // Auto-export: trigger download once data is loaded + view applied
  const autoExported = useRef(false)
  useEffect(() => {
    if (!autoExport || autoExported.current || processedData.length === 0) return
    // Wait a tick for view to be fully applied
    const timer = setTimeout(() => {
      autoExported.current = true
      const cols = visibleColumns.map((c) => ({ key: c.key as string, label: c.label }))
      const exportData = processedData as Record<string, unknown>[]
      if (autoExport === 'csv') {
        exportToCSV(exportData, cols, exportFilename || 'export')
      } else if (onExcelExport) {
        onExcelExport(exportData as T[], visibleColumns, exportFilename || 'export')
      } else {
        exportToExcel(exportData, cols, exportFilename || 'export')
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [autoExport, processedData, visibleColumns, exportFilename, onExcelExport])

  const hasActiveFilters = filters.size > 0 || searchTerm.trim() !== ''

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
      const allCols = columns.map((c) => c.key)
      const fromIdx = allCols.indexOf(dragColKey)
      const toIdx = allCols.indexOf(targetKey)
      if (fromIdx >= 0 && toIdx >= 0) moveColumn(fromIdx, toIdx)
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

  // Only render the view appropriate for the screen size to avoid wasted React work
  // and prevent hidden-view errors from crashing the visible view
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder={t('ui.search')} value={searchTerm} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
          {searchTerm && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
          <Button variant="outline" size="sm" onClick={resetView} title={t('ui.reset')}>
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">{t('ui.reset')}</span>
          </Button>

          {page && (
            <ViewsMenu
              page={page}
              getCurrentConfig={getViewConfig}
              onApplyView={applyView}
            />
          )}

          <ColumnToggle columns={columns} hiddenColumns={hiddenColumns} onToggle={toggleColumn} />
          <ExportMenu data={processedData} columns={visibleColumns} filename={exportFilename} onExcelExport={onExcelExport} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {processedData.length} {noun}{processedData.length !== 1 ? 's' : ''}
        {hasActiveFilters && ` (filtered from ${data.length})`}
      </p>

      {(!isMobile) && (
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {visibleColumns.map((col, colIdx) => (
                <th
                  key={col.key}
                  className={cn('text-left font-medium px-3 py-2 select-none', dragOverColKey === col.key && dragColKey !== col.key && 'bg-primary/10 border-l-2 border-l-primary')}
                  draggable
                  onDragStart={() => handleDragStart(col.key, colIdx)}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                  onDrop={(e) => handleDrop(e, col.key)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex items-center gap-1">
                    <span className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground mr-0.5" title="Drag to reorder">⠿</span>
                    {col.sortable !== false ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors active:scale-95 transition-transform duration-100"
                      >
                        {col.label}
                        <SortIcon columnKey={col.key} sortKey={sortKey} sortDir={sortDir} />
                      </button>
                    ) : <span>{col.label}</span>}
                    {col.filterable !== false && (
                      <ColumnFilter
                        columnKey={col.key}
                        data={data.map((row) => {
                          const val = row[col.key]
                          // Convert objects/arrays to strings for filtering
                          if (typeof val === 'object' && val !== null) {
                            return Array.isArray(val) ? val.map(String).join(', ') : String(val)
                          }
                          return val
                        })}
                        activeFilter={filters.get(col.key)}
                        onApply={setFilter}
                        onClear={clearFilter}
                        onHide={toggleColumn}
                      />
                    )}
                    {/* #4 — Active filter pulsing dot */}
                    {filters.has(col.key) && (
                      <span
                        className="inline-block size-1.5 rounded-full bg-primary"
                        style={{ animation: 'pulse-dot 1.5s ease-in-out infinite' }}
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedData.map((row, i) => {
              return (
                <RowErrorBoundary key={getRowKey?.(row, i) ?? i}>
                <TableRow
                  row={row}
                  index={i}
                  visibleColumns={visibleColumns}
                  disableAnimation={disableAnimation}
                  expandedRowKey={expandedRowKey}
                  onRowClick={onRowClick}
                  renderExpandedContent={renderExpandedContent}
                  rowClassName={rowClassName}
                  getRowKey={getRowKey}
                />
                </RowErrorBoundary>
              )
            })}
            {processedData.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length}>
                  <EmptyState
                    type={hasActiveFilters ? 'filtered' : 'no-data'}
                    onClearFilters={hasActiveFilters ? clearAllFilters : undefined}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {isMobile && (
      <div className="space-y-3">
        {processedData.map((row, i) => (
          <CardErrorBoundary key={i}>
            {renderCard ? renderCard(row, i) : <DefaultCard row={row} columns={visibleColumns} className={cardClassName?.(row)} />}
          </CardErrorBoundary>
        ))}
        {processedData.length === 0 && (
          <EmptyState
            type={hasActiveFilters ? 'filtered' : 'no-data'}
            onClearFilters={hasActiveFilters ? clearAllFilters : undefined}
          />
        )}
      </div>
      )}
    </div>
  )
}

function DefaultCard<T extends Record<string, unknown>>({ row, columns, className }: { row: T; columns: ColumnDef<T>[]; className?: string }) {
  const [first, ...rest] = columns
  return (
    <Card className={cn('border-l-4', className)}>
      <CardContent className="pt-4 pb-3 px-4 space-y-2">
        {first && <p className="font-semibold">{first.render ? safeCellRender(first.render(row[first.key], row)) : formatCellValue(row[first.key])}</p>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {rest.map((col) => (
            <div key={col.key}>
              <span className="text-muted-foreground">{col.label}</span>
              <p className="font-medium">{col.render ? safeCellRender(col.render(row[col.key], row)) : formatCellValue(row[col.key])}</p>
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
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(String).join(', ')
    try { return JSON.stringify(value) } catch { return '[object]' }
  }
  return String(value)
}

/** Ensures render() output is a valid React child — catches plain objects that would cause error #300 */
function safeCellRender(node: React.ReactNode): React.ReactNode {
  if (node === null || node === undefined) return '-'
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node
  if (isValidElement(node)) return node
  if (Array.isArray(node)) return node.map((n, i) => <Fragment key={i}>{safeCellRender(n)}</Fragment>)
  // Plain object — not a valid React child
  return formatCellValue(node)
}
