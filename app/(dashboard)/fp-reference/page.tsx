'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Minus } from 'lucide-react'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { InventoryPopover } from '@/components/InventoryPopover'
import { BomExpandPanel } from '@/components/customer-reference/BomExpandPanel'
import { DrawingIconButton } from '@/components/customer-reference/DrawingIconButton'
import { fetchBomMaps, emptyBomMaps, type BomMaps } from '@/lib/customer-reference-bom'

type FPRecord = Record<string, unknown>

// Sheet column headers we special-case. Must match the exact strings returned
// by /api/generic-sheet?gid=fpReference (verified 2026-04-23).
const PART_NUMBER_COL = 'Part number'
const TIRE_COL = 'Tire'
const HUB_COL = 'Hub'

const FP_EXPAND_PANEL_ID = 'fp-bom-expand-panel'

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function normPN(pn: string): string {
  return pn.trim().toUpperCase()
}

export default function FPReferencePage() {
  return <Suspense><FPReferencePageContent /></Suspense>
}

function FPReferencePageContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [data, setData] = useState<FPRecord[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // BOM expand state
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
  const [bomMaps, setBomMaps] = useState<BomMaps>(() => emptyBomMaps())
  const [bomMapsLoading, setBomMapsLoading] = useState(true)
  const [bomMapsError, setBomMapsError] = useState(false)
  const bomAbortRef = useRef<AbortController | null>(null)

  const loadBomMaps = useCallback(() => {
    bomAbortRef.current?.abort()
    const ctrl = new AbortController()
    bomAbortRef.current = ctrl
    setBomMapsLoading(true)
    setBomMapsError(false)
    fetchBomMaps(ctrl.signal)
      .then((maps) => {
        if (!ctrl.signal.aborted) setBomMaps(maps)
      })
      .catch((err) => {
        if (ctrl.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
        setBomMapsError(true)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBomMapsLoading(false)
      })
  }, [])

  useEffect(() => {
    // Classic fetch-on-mount effect: setState happens through loadBomMaps.
    // Byte-identical to /customer-reference, which lints clean — the
    // react-hooks/set-state-in-effect rule's transitive-call analysis varies
    // by component size, so the suppression is rule-heuristic, not a real
    // smell. Refactoring this into useSyncExternalStore would be overkill.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBomMaps()
    return () => bomAbortRef.current?.abort()
  }, [loadBomMaps])

  useEffect(() => {
    fetch('/api/generic-sheet?gid=fpReference')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch FP Reference data')
        return res.json()
      })
      .then(({ headers: hs, data: rows }: { headers: string[]; data: FPRecord[] }) => {
        setHeaders(hs)
        setData(rows)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Helper: does an FPRecord have a matching BOM entry?
  const hasBom = useCallback((pn: string): boolean => {
    if (!pn) return false
    const key = normPN(pn)
    return bomMaps.finalByPN.has(key) || bomMaps.subByPN.has(key) || bomMaps.individualByPN.has(key)
  }, [bomMaps])

  // Stable unique row key per FPRecord, computed once per data load. Uses a
  // WeakMap keyed on the row object so the cell render, getRowKey, and the
  // DataTable's `expandedRowKey === rowKey` comparison all agree — even when
  // two rows share a PN or PN is empty. Without this, duplicate PNs would
  // expand together and empty-PN rows would visually toggle without a panel.
  const rowKeyMap = useMemo(() => {
    const map = new WeakMap<FPRecord, string>()
    data.forEach((row, i) => {
      const pn = str(row[PART_NUMBER_COL])
      map.set(row, `${pn || 'row'}-${i}`)
    })
    return map
  }, [data])

  // Build columns once headers are known. Special-case 3 columns; everything
  // else stays plain (sortable + filterable, header label = sheet column name).
  const columns: ColumnDef<FPRecord>[] = useMemo(() => {
    return headers.map((h): ColumnDef<FPRecord> => {
      if (h === PART_NUMBER_COL) {
        return {
          key: h,
          label: h,
          sortable: true,
          filterable: true,
          render: (v, row) => {
            const pn = str(v)
            // Skip the chevron entirely on rows with no PN — there's nothing
            // to resolve a BOM against, so offering an expand affordance is
            // just a broken promise.
            if (!pn) return <span className="font-mono text-sm text-muted-foreground/50">—</span>
            const rowKey = rowKeyMap.get(row) ?? pn
            const isOpen = expandedRowKey === rowKey
            const present = bomMapsLoading ? null : hasBom(pn)
            const tooltipKey = isOpen
              ? 'customerRef.collapseRow'
              : present === true ? 'fpRef.hasBomTooltip'
              : present === false ? 'fpRef.noBomTooltip'
              : 'customerRef.bomLoading'
            return (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExpandedRowKey((prev) => prev === rowKey ? null : rowKey) }}
                  title={t(tooltipKey)}
                  aria-label={t(tooltipKey)}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? FP_EXPAND_PANEL_ID : undefined}
                  className={`inline-flex items-center justify-center size-[18px] rounded-[4px] leading-none transition-all duration-150 hover:scale-110 active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                    isOpen
                      ? 'bg-primary/30 text-primary ring-1 ring-primary/40'
                      : present === true
                        ? 'bg-primary/15 text-primary hover:bg-primary/25'
                        : present === false
                          ? 'bg-muted/40 text-muted-foreground/40 hover:bg-muted/60 hover:text-muted-foreground/70'
                          : 'bg-muted/30 text-muted-foreground/50'
                  }`}
                >
                  {isOpen
                    ? <ChevronDown className="size-[11px]" />
                    : present === false
                      ? <Minus className="size-[10px]" />
                      : <ChevronRight className="size-[11px]" />}
                </button>
                <span className={`font-mono text-sm ${present === false ? 'text-muted-foreground/80' : ''}`}>
                  {pn}
                </span>
              </span>
            )
          },
        }
      }

      if (h === TIRE_COL) {
        return {
          key: h,
          label: h,
          sortable: true,
          filterable: true,
          render: (v) => {
            const tire = str(v)
            if (!tire) return <span className="text-muted-foreground/50">—</span>
            const drawing = bomMaps.drawingsByPN.get(normPN(tire))
            return (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-sm">{tire}</span>
                <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1">
                  <InventoryPopover partNumber={tire} partType="tire" />
                  <DrawingIconButton partNumber={tire} drawingUrls={drawing?.drawingUrls ?? []} />
                </span>
              </span>
            )
          },
        }
      }

      if (h === HUB_COL) {
        return {
          key: h,
          label: h,
          sortable: true,
          filterable: true,
          render: (v) => {
            const hub = str(v)
            if (!hub) return <span className="text-muted-foreground/50">—</span>
            const drawing = bomMaps.drawingsByPN.get(normPN(hub))
            return (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-sm">{hub}</span>
                <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1">
                  <InventoryPopover partNumber={hub} partType="hub" />
                  <DrawingIconButton partNumber={hub} drawingUrls={drawing?.drawingUrls ?? []} />
                </span>
              </span>
            )
          },
        }
      }

      return { key: h, label: h, sortable: true, filterable: true }
    })
  }, [headers, expandedRowKey, bomMaps, bomMapsLoading, hasBom, rowKeyMap, t])

  const table = useDataTable({
    data,
    columns,
    storageKey: 'fp-reference',
  })

  const getRowKey = useCallback((row: FPRecord, index: number): string => {
    return rowKeyMap.get(row) ?? `row-${index}`
  }, [rowKeyMap])

  const rowClassName = useCallback((row: FPRecord): string => {
    const pn = str(row[PART_NUMBER_COL])
    if (!pn || bomMapsLoading) return ''
    return hasBom(pn) ? 'border-l-2 border-l-emerald-500/40' : ''
  }, [hasBom, bomMapsLoading])

  // Stats — split has-BOM vs no-BOM counts once the maps are loaded so the
  // header gives Simon a glanceable count of which parts still need a BOM.
  const stats = useMemo(() => {
    const total = data.length
    if (bomMapsLoading) return { total, withBom: 0, withoutBom: 0 }
    let withBom = 0
    for (const row of data) {
      const pn = str(row[PART_NUMBER_COL])
      if (pn && hasBom(pn)) withBom++
    }
    return { total, withBom, withoutBom: total - withBom }
  }, [data, hasBom, bomMapsLoading])

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📋 {t('page.fpReference')}</h1>
      <p className="text-muted-foreground text-sm mb-4">
        {t('page.fpReferenceSubtitle')}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-600">{t('stats.totalRecords')}</p>
          <p className="text-xl font-bold text-blue-600">{stats.total}</p>
        </div>
        <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
          <p className="text-xs text-emerald-500">{t('fpRef.withBom')}</p>
          <p className="text-xl font-bold text-emerald-500">
            {bomMapsLoading ? '—' : stats.withBom}
          </p>
        </div>
        <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/20">
          <p className="text-xs text-amber-500">{t('fpRef.withoutBom')}</p>
          <p className="text-xl font-bold text-amber-500">
            {bomMapsLoading ? '—' : stats.withoutBom}
          </p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">{t('ui.columns')}</p>
          <p className="text-xl font-bold">{columns.length}</p>
        </div>
      </div>

      {loading && <TableSkeleton rows={8} />}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && columns.length > 0 && (
        <DataTable
          table={table}
          data={data}
          noun="record"
          exportFilename="fp-reference.csv"
          page="fp-reference"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={getRowKey}
          rowClassName={rowClassName}
          expandedRowKey={expandedRowKey}
          renderExpandedContent={(row) => {
            const pn = str(row[PART_NUMBER_COL])
            const pnKey = normPN(pn)
            return (
              <BomExpandPanel
                id={FP_EXPAND_PANEL_ID}
                partNumber={pn}
                loading={bomMapsLoading}
                errored={bomMapsError}
                onRetry={loadBomMaps}
                finalAssembly={bomMaps.finalByPN.get(pnKey) ?? null}
                subAssembly={bomMaps.subByPN.get(pnKey) ?? null}
                individualItem={bomMaps.individualByPN.get(pnKey) ?? null}
                drawings={bomMaps.drawingsByPN}
              />
            )
          }}
        />
      )}
    </div>
  )
}
