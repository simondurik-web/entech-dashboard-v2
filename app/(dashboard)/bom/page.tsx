'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ChevronRight, Package, Layers, DollarSign, Search, RefreshCw } from 'lucide-react'
import type { BOMItem, BOMComponent } from '@/lib/google-sheets'

type BOMTab = 'final' | 'sub' | 'individual'

const TAB_CONFIG: Record<
  BOMTab,
  { label: string; endpoint: string; emptyMessage: string }
> = {
  final: {
    label: 'Final Assembly',
    endpoint: '/api/bom',
    emptyMessage: 'No final assembly BOM data available. Check the Google Sheets BOM tabs.',
  },
  sub: {
    label: 'Sub Assembly',
    endpoint: '/api/bom-sub',
    emptyMessage: 'No sub-assembly BOM data available. Check the Google Sheets BOM tabs.',
  },
  individual: {
    label: 'Individual Items',
    endpoint: '/api/bom-individual',
    emptyMessage: 'No individual item BOM data available. Check the Google Sheets BOM tabs.',
  },
}

function getCategoryColor(category: BOMComponent['category']) {
  switch (category) {
    case 'raw':
      return 'bg-amber-500/20 text-amber-600'
    case 'component':
      return 'bg-blue-500/20 text-blue-600'
    case 'assembly':
      return 'bg-purple-500/20 text-purple-600'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function getCategoryLabel(category: BOMComponent['category']) {
  switch (category) {
    case 'raw':
      return 'Raw Material'
    case 'component':
      return 'Component'
    case 'assembly':
      return 'Sub-Assembly'
    default:
      return category
  }
}

export default function BOMExplorerPage() {
  const [bomData, setBomData] = useState<BOMItem[]>([])
  const [activeTab, setActiveTab] = useState<BOMTab>('final')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPart, setSelectedPart] = useState<BOMItem | null>(null)

  const fetchData = useCallback(async (tab: BOMTab, isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch(TAB_CONFIG[tab].endpoint)
      if (!res.ok) throw new Error('Failed to fetch BOM data')
      const data: BOMItem[] = await res.json()
      setBomData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    setSearchTerm('')
    setSelectedPart(null)
    fetchData(activeTab)
  }, [activeTab, fetchData])

  useEffect(() => {
    if (!selectedPart) return
    const matchedPart = bomData.find((item) => item.partNumber === selectedPart.partNumber) || null
    setSelectedPart(matchedPart)
  }, [bomData, selectedPart])

  const filteredParts = bomData.filter((item) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      item.partNumber.toLowerCase().includes(term) ||
      item.product.toLowerCase().includes(term)
    )
  })

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📋 BOM Explorer</h1>
        <button
          onClick={() => fetchData(activeTab, true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        Bill of Materials breakdown by product
      </p>

      <div className="mb-4 border-b">
        <div className="flex gap-1">
          {(Object.keys(TAB_CONFIG) as BOMTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              aria-current={activeTab === tab ? 'page' : undefined}
            >
              {TAB_CONFIG[tab].label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && bomData.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <Layers className="size-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {TAB_CONFIG[activeTab].emptyMessage}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && bomData.length > 0 && (
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Part selector panel */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="size-4" />
                Select Product ({bomData.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search parts..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-[500px] overflow-y-auto space-y-1">
                {filteredParts.map((item) => (
                  <button
                    key={item.partNumber}
                    onClick={() => setSelectedPart(item)}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between ${
                      selectedPart?.partNumber === item.partNumber
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div>
                      <p className="font-medium text-sm">{item.partNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.product}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
                {filteredParts.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm py-4">
                    No parts found
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* BOM details panel */}
          <div className="lg:col-span-2 space-y-4">
            {!selectedPart ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                  <Layers className="size-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    Select a product to view its Bill of Materials
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Product header */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-xl">{selectedPart.partNumber}</CardTitle>
                        <p className="text-muted-foreground">{selectedPart.product}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total Cost</p>
                        <p className="text-2xl font-bold text-green-600">
                          ${selectedPart.totalCost.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {/* Components breakdown */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Layers className="size-4" />
                      Components ({selectedPart.components.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {selectedPart.components.map((component, idx) => (
                        <div
                          key={component.partNumber + idx}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(
                                component.category
                              )}`}
                            >
                              {getCategoryLabel(component.category)}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{component.partNumber}</p>
                              <p className="text-xs text-muted-foreground">
                                {component.description}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {component.quantity} {component.unit}
                            </p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                              <DollarSign className="size-3" />
                              {(component.quantity * component.costPerUnit).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Cost breakdown summary */}
                    <div className="mt-4 pt-4 border-t">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Raw Materials</p>
                          <p className="text-lg font-semibold text-amber-600">
                            $
                            {selectedPart.components
                              .filter((c) => c.category === 'raw')
                              .reduce((sum, c) => sum + c.quantity * c.costPerUnit, 0)
                              .toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Components</p>
                          <p className="text-lg font-semibold text-blue-600">
                            $
                            {selectedPart.components
                              .filter((c) => c.category === 'component')
                              .reduce((sum, c) => sum + c.quantity * c.costPerUnit, 0)
                              .toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="text-lg font-semibold text-green-600">
                            ${selectedPart.totalCost.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
