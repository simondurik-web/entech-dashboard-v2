'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { ProductionMakeItem } from '@/lib/google-sheets'
import { InventoryPopover } from '@/components/InventoryPopover'

// Product type filters matching v1
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'tire', label: 'Tires', color: 'bg-orange-500' },
  { key: 'hub', label: 'Hubs', color: 'bg-teal-500' },
  { key: 'finished', label: 'Finished Parts', color: 'bg-purple-500' },
  { key: 'bearing', label: 'Bearings', color: 'bg-gray-500' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

type ProductionRow = ProductionMakeItem & Record<string, unknown>

const COLUMNS: ColumnDef<ProductionRow>[] = [
  { key: 'product', label: 'Product', sortable: true, filterable: true },
  {
    key: 'partNumber', label: 'Part #', sortable: true, filterable: true,
    render: (v) => (
      <span className="inline-flex items-center gap-1">
        <span className="font-bold">{String(v)}</span>
        <InventoryPopover partNumber={String(v)} partType="part" />
      </span>
    ),
  },
  { key: 'moldType', label: 'Mold Type', sortable: true, filterable: true },
  {
    key: 'fusionInventory',
    label: 'Fusion Inv',
    sortable: true,
    render: (v) => (v as number).toLocaleString(),
  },
  {
    key: 'minimums',
    label: 'Minimums',
    sortable: true,
    render: (v) => (v as number).toLocaleString(),
  },
  {
    key: 'partsToBeMade',
    label: 'Parts to Make',
    sortable: true,
    render: (v) => {
      const val = v as number
      if (val > 0) {
        return <span className="font-bold text-orange-500">{val.toLocaleString()}</span>
      }
      return <span className="text-green-500">0</span>
    },
  },
]

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
  const [items, setItems] = useState<ProductionMakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

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
    columns: COLUMNS,
    storageKey: 'need-to-make',
  })

  // Stats
  const totalParts = filtered.length
  const totalToMake = filtered.reduce((sum, item) => sum + item.partsToBeMade, 0)
  const needsProduction = filtered.filter((item) => item.partsToBeMade > 0).length
  const fullyStocked = filtered.filter((item) => item.partsToBeMade === 0).length

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">🏭 Need to Make</h1>
      <p className="text-muted-foreground text-sm mb-4">Parts to manufacture based on inventory vs minimums</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Parts</p>
          <p className="text-xl font-bold">{totalParts}</p>
        </div>
        <div className="bg-orange-500/10 rounded-lg p-3">
          <p className="text-xs text-orange-500">Parts to Make</p>
          <p className="text-xl font-bold text-orange-500">{totalToMake.toLocaleString()}</p>
        </div>
        <div className="bg-red-500/10 rounded-lg p-3">
          <p className="text-xs text-red-500">Needs Production</p>
          <p className="text-xl font-bold text-red-500">{needsProduction}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-500">Fully Stocked</p>
          <p className="text-xl font-bold text-green-500">{fullyStocked}</p>
        </div>
      </div>

      {/* Product type filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              filter === f.key
                ? f.key === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : `${f.color} text-white`
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
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
                        Make {item.partsToBeMade}
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">
                        ✓ Stocked
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">In Stock</span>
                      <p className="font-semibold">{item.fusionInventory.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Minimum</span>
                      <p className="font-semibold">{item.minimums.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Mold</span>
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
