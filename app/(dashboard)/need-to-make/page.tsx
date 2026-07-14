'use client'

import { Suspense, useEffect, useState, useMemo, useCallback } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { ProductionMakeItem } from '@/lib/google-sheets-shared'
import { InventoryPopover } from '@/components/InventoryPopover'
import { EditableMinimum } from '@/components/EditableMinimum'
import { usePermissions } from '@/lib/use-permissions'
import { useI18n } from '@/lib/i18n'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { useCountUp } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'

// Product type filter keys
const FILTER_KEYS = ['all', 'tire', 'hub', 'finished', 'bearing'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

const FILTER_COLORS: Record<FilterKey, string | undefined> = {
  all: undefined,
  tire: 'bg-orange-500',
  hub: 'bg-teal-500',
  finished: 'bg-purple-500',
  bearing: 'bg-gray-500',
}

const FILTER_I18N: Record<FilterKey, string> = {
  all: 'category.all',
  tire: 'needToMake.tires',
  hub: 'needToMake.hubs',
  finished: 'needToMake.finishedParts',
  bearing: 'needToMake.bearings',
}

type ProductionRow = ProductionMakeItem & Record<string, unknown>

function filterByProduct(items: ProductionMakeItem[], filter: FilterKey): ProductionMakeItem[] {
  if (filter === 'all') return items

  return items.filter((item) => {
    const product = item.product.toLowerCase()
    switch (filter) {
      case 'tire':
        return product.includes('tire')
      case 'hub':
        return product.includes('hub')
      case 'finished':
        return product.includes('finished') || product.includes('rubber molded')
      case 'bearing':
        return product.includes('bearing')
      default:
        return true
    }
  })
}

function borderColor(item: ProductionMakeItem): string {
  if (item.partsToBeMade > item.minimums * 0.5) return 'border-l-red-500'
  if (item.partsToBeMade > 0) return 'border-l-orange-500'
  return 'border-l-green-500'
}

// Phone card: tap to expand the full desktop-table detail (Simon 2026-07-08 —
// the collapsed card hid most columns). Part number carries the availability
// color: green = stocked (nothing to make), red = production needed.
function NeedToMakeCard({ item, t, canEditMinimums, onMinimumSaved }: {
  item: ProductionMakeItem
  t: (key: string) => string
  canEditMinimums: boolean
  onMinimumSaved: (partNumber: string, minimum: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const partColor = item.partsToBeMade > 0 ? 'text-red-400' : 'text-green-500'
  const short = item.neededOpenOrders > item.fusionInventory

  return (
    <Card className={`border-l-4 cursor-pointer transition-colors ${borderColor(item)} ${expanded ? 'ring-1 ring-primary/20' : ''}`}
      onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <CardTitle className={`text-lg leading-tight ${partColor}`}>
              <span className="inline-flex items-center gap-1.5">
                <span className="truncate">{item.partNumber}</span>
                <span onClick={(e) => e.stopPropagation()}><InventoryPopover partNumber={item.partNumber} partType="part" needed={item.neededOpenOrders} /></span>
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{item.product}</p>
          </div>
          {item.partsToBeMade > 0 ? (
            <span className="px-2 py-1 text-xs rounded bg-orange-500/20 text-orange-600 font-bold whitespace-nowrap">
              {t('needToMake.make')} {item.partsToBeMade.toLocaleString()}
            </span>
          ) : (
            <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600 whitespace-nowrap">
              {t('needToMake.stocked')}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">{t('table.fusionInv')}</span>
            <p className={`font-semibold ${item.fusionInventory <= 0 ? 'text-red-400' : ''}`}>{item.fusionInventory.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t('table.minimum')}</span>
            <p className="font-semibold">{item.minimums.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t('table.neededOpenOrders')}</span>
            <p className={`font-semibold ${short ? 'text-red-400' : ''}`}>{item.neededOpenOrders.toLocaleString()}</p>
          </div>
        </div>
        {/* Expanded: the rest of the desktop columns */}
        <div className={`grid transition-all duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {expanded && (
              <div className="grid grid-cols-3 gap-2 text-sm rounded-lg bg-muted/40 p-2.5">
                <div>
                  <span className="text-muted-foreground">{t('table.onHand')}</span>
                  <p className="font-semibold">{item.onHand.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('table.committed')}</span>
                  <p className={`font-semibold ${item.committed > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {item.committed > 0 ? item.committed.toLocaleString() : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('table.fusionInv')}</span>
                  <p className="font-semibold">{item.fusionInventory.toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('table.minimums')}</span>
                  {canEditMinimums ? (
                    <p className="font-semibold">
                      <EditableMinimum partNumber={item.partNumber} value={item.minimums} onSaved={onMinimumSaved} />
                    </p>
                  ) : (
                    <p className="font-semibold">{item.minimums.toLocaleString()}</p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">{t('table.partsToMake')}</span>
                  <p className={`font-semibold ${item.partsToBeMade > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                    {item.partsToBeMade.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('needToMake.mold')}</span>
                  <p className="font-semibold text-xs">{item.moldType || '-'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function NeedToMakePage() {
  return <Suspense><NeedToMakePageContent /></Suspense>
}

function NeedToMakePageContent() {
  const { t } = useI18n()
  const { canAccess } = usePermissions()
  const canEditMinimums = canAccess('edit_minimums')
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [items, setItems] = useState<ProductionMakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  // Inline minimum edit (manager/shipping_manager/admin) — recompute this
  // row's Parts to Make with the same rule the API uses.
  const onMinimumSaved = useCallback((partNumber: string, minimum: number) => {
    setItems(prev => prev.map(i => {
      if (i.partNumber.toUpperCase() !== partNumber.toUpperCase()) return i
      const partsToBeMade = Math.max(0, Math.max(minimum, i.neededOpenOrders) - i.fusionInventory)
      return { ...i, minimums: minimum, partsToBeMade }
    }))
  }, [])

  const columns: ColumnDef<ProductionRow>[] = useMemo(() => [
    { key: 'product', label: t('table.product'), sortable: true, filterable: true },
    {
      key: 'partNumber', label: t('table.partNumber'), sortable: true, filterable: true,
      render: (v, row) => (
        <span className="inline-flex items-center gap-1">
          <span className="font-bold">{String(v)}</span>
          <InventoryPopover partNumber={String(v)} partType="part" needed={row.neededOpenOrders as number} />
        </span>
      ),
    },
    { key: 'moldType', label: t('table.moldType'), sortable: true, filterable: true },
    {
      key: 'onHand',
      label: t('table.onHand'),
      sortable: true,
      render: (v) => ((v as number) ?? 0).toLocaleString(),
    },
    {
      key: 'committed',
      label: t('table.committed'),
      sortable: true,
      render: (v) => {
        const n = (v as number) ?? 0
        return n > 0
          ? <span className="text-amber-400 font-semibold">{n.toLocaleString()}</span>
          : <span className="text-muted-foreground">—</span>
      },
    },
    {
      key: 'fusionInventory',
      label: t('table.fusionInv'),
      sortable: true,
      render: (v) => <span className="font-semibold">{(v as number).toLocaleString()}</span>,
    },
    {
      key: 'minimums',
      label: t('table.minimums'),
      sortable: true,
      render: (v, row) => canEditMinimums
        ? <EditableMinimum partNumber={String(row.partNumber)} value={v as number} onSaved={onMinimumSaved} />
        : (v as number).toLocaleString(),
    },
    {
      key: 'neededOpenOrders',
      label: t('table.neededOpenOrders'),
      sortable: true,
      render: (v, row) => {
        const val = (v as number) ?? 0
        if (val === 0) return <span className="text-muted-foreground">0</span>
        const short = val > (row.fusionInventory as number)
        return <span className={short ? 'text-red-400 font-semibold' : ''}>{val.toLocaleString()}</span>
      },
    },
    {
      key: 'partsToBeMade',
      label: t('table.partsToMake'),
      sortable: true,
      render: (v) => {
        const val = v as number
        if (val > 0) {
          return <span className="font-bold text-orange-500">{val.toLocaleString()}</span>
        }
        return <span className="text-green-500">0</span>
      },
    },
  ], [t, canEditMinimums, onMinimumSaved])

  useEffect(() => {
    fetch('/api/production-make')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch production data')
        return res.json()
      })
      .then((data: ProductionMakeItem[]) => {
        setItems(data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByProduct(items, filter) as ProductionRow[]

  const table = useDataTable({
    data: filtered,
    columns,
    storageKey: 'need-to-make',
  })

  // Stats
  const totalParts = filtered.length
  const totalToMake = filtered.reduce((sum, item) => sum + item.partsToBeMade, 0)
  const needsProduction = filtered.filter((item) => item.partsToBeMade > 0).length
  const fullyStocked = filtered.filter((item) => item.partsToBeMade === 0).length

  const animTotalParts = useCountUp(totalParts)
  const animTotalToMake = useCountUp(totalToMake)
  const animNeedsProduction = useCountUp(needsProduction)
  const animFullyStocked = useCountUp(fullyStocked)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">{t('page.needToMake')}</h1>
      <p className="text-muted-foreground text-sm mb-4">{t('page.needToMakeSubtitle')}</p>

      {/* Stats row */}
      <ScrollReveal>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SpotlightCard className="bg-muted rounded-lg p-3 stat-card-hover" spotlightColor="148,163,184">
          <p className="text-xs text-muted-foreground">{t('stats.totalParts')}</p>
          <p className="text-xl font-bold">{animTotalParts}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-orange-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-amber" spotlightColor="249,115,22">
          <p className="text-xs text-orange-500">{t('stats.partsToMake')}</p>
          <p className="text-xl font-bold text-orange-500">{animTotalToMake.toLocaleString()}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-red-500/10 rounded-lg p-3 stat-card-hover" spotlightColor="239,68,68">
          <p className="text-xs text-red-500">{t('stats.needsProduction')}</p>
          <p className="text-xl font-bold text-red-500">{animNeedsProduction}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-green-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-green" spotlightColor="34,197,94">
          <p className="text-xs text-green-500">{t('stats.fullyStocked')}</p>
          <p className="text-xl font-bold text-green-500">{animFullyStocked}</p>
        </SpotlightCard>
      </div>
      </ScrollReveal>

      {/* Product type filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              filter === key
                ? key === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : `${FILTER_COLORS[key]} text-white`
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {t(FILTER_I18N[key])}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <TableSkeleton rows={8} />
      )}

      {/* Error state */}
      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {/* Data table */}
      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun={t('needToMake.noun')}
          exportFilename="need-to-make.csv"
          page="need-to-make"
          initialView={initialView}
          autoExport={autoExport}
          cardClassName={(row) => `border-l-4 ${borderColor(row as unknown as ProductionMakeItem)}`}
          renderCard={(row, i) => {
            const item = row as unknown as ProductionMakeItem
            return (
              <NeedToMakeCard
                key={`${item.partNumber}-${i}`}
                item={item}
                t={t}
                canEditMinimums={canEditMinimums}
                onMinimumSaved={onMinimumSaved}
              />
            )
          }}
        />
      )}
    </div>
  )
}
