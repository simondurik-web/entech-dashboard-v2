'use client'

import { Suspense, useEffect, useState, useMemo } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { ProductionMakeItem } from '@/lib/google-sheets'
import { InventoryPopover } from '@/components/InventoryPopover'
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

export default function NeedToMakePage() {
  return <Suspense><NeedToMakePageContent /></Suspense>
}

function NeedToMakePageContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [items, setItems] = useState<ProductionMakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  const columns: ColumnDef<ProductionRow>[] = useMemo(() => [
    { key: 'product', label: t('table.product'), sortable: true, filterable: true },
    {
      key: 'partNumber', label: t('table.partNumber'), sortable: true, filterable: true,
      render: (v) => (
        <span className="inline-flex items-center gap-1">
          <span className="font-bold">{String(v)}</span>
          <InventoryPopover partNumber={String(v)} partType="part" />
        </span>
      ),
    },
    { key: 'moldType', label: t('table.moldType'), sortable: true, filterable: true },
    {
      key: 'fusionInventory',
      label: t('table.fusionInv'),
      sortable: true,
      render: (v) => (v as number).toLocaleString(),
    },
    {
      key: 'minimums',
      label: t('table.minimums'),
      sortable: true,
      render: (v) => (v as number).toLocaleString(),
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
  ], [t])

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
        <SpotlightCard className="bg-muted rounded-lg p-3" spotlightColor="148,163,184">
          <p className="text-xs text-muted-foreground">{t('stats.totalParts')}</p>
          <p className="text-xl font-bold">{animTotalParts}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-orange-500/10 rounded-lg p-3" spotlightColor="249,115,22">
          <p className="text-xs text-orange-500">{t('stats.partsToMake')}</p>
          <p className="text-xl font-bold text-orange-500">{animTotalToMake.toLocaleString()}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-red-500/10 rounded-lg p-3" spotlightColor="239,68,68">
          <p className="text-xs text-red-500">{t('stats.needsProduction')}</p>
          <p className="text-xl font-bold text-red-500">{animNeedsProduction}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-green-500/10 rounded-lg p-3" spotlightColor="34,197,94">
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
          noun="part"
          exportFilename="need-to-make.csv"
          page="need-to-make"
          initialView={initialView}
          autoExport={autoExport}
          cardClassName={(row) => `border-l-4 ${borderColor(row as unknown as ProductionMakeItem)}`}
          renderCard={(row, i) => {
            const item = row as unknown as ProductionMakeItem
            return (
              <Card key={`${item.partNumber}-${i}`} className={`border-l-4 ${borderColor(item)}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{item.partNumber}</CardTitle>
                      <p className="text-sm text-muted-foreground">{item.product}</p>
                    </div>
                    {item.partsToBeMade > 0 ? (
                      <span className="px-2 py-1 text-xs rounded bg-orange-500/20 text-orange-600 font-bold">
                        {t('needToMake.make')} {item.partsToBeMade}
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">
                        {t('needToMake.stocked')}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t('needToMake.inStock')}</span>
                      <p className="font-semibold">{item.fusionInventory.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('table.minimum')}</span>
                      <p className="font-semibold">{item.minimums.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('needToMake.mold')}</span>
                      <p className="font-semibold text-xs">{item.moldType || '-'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          }}
        />
      )}
    </div>
  )
}
