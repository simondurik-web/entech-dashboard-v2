'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ChevronRight, Package, Layers, DollarSign, Search, RefreshCw, BarChart3, X, Copy } from 'lucide-react'
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
    case 'packaging':
      return 'bg-slate-500/20 text-slate-600'
    case 'energy':
      return 'bg-purple-500/20 text-purple-600'
    case 'assembly':
      return 'bg-indigo-500/20 text-indigo-600'
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
    case 'packaging':
      return 'Packaging'
    case 'energy':
      return 'Energy/Labor'
    case 'assembly':
      return 'Sub-Assembly'
    default:
      return category
  }
}

const barColors: Record<string, string> = {
  raw: 'bg-amber-500',
  component: 'bg-blue-500',
  packaging: 'bg-slate-500',
  energy: 'bg-purple-500',
  assembly: 'bg-indigo-500',
}

export default function BOMExplorerPage() {
  const [bomData, setBomData] = useState<BOMItem[]>([])
  const [activeTab, setActiveTab] = useState<BOMTab>('final')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPart, setSelectedPart] = useState<BOMItem | null>(null)
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set())
  const [showCompare, setShowCompare] = useState(false)
  const [duplicateMsg, setDuplicateMsg] = useState(false)

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
    setCompareSet(new Set())
    setShowCompare(false)
    fetchData(activeTab)
  }, [activeTab, fetchData])

  useEffect(() => {
    if (!selectedPart) return
    const matchedPart = bomData.find((item) => item.partNumber === selectedPart.partNumber) || null
    setSelectedPart(matchedPart)
  }, [bomData, selectedPart])

  const toggleCompare = (partNumber: string) => {
    setCompareSet(prev => {
      const next = new Set(prev)
      if (next.has(partNumber)) next.delete(partNumber)
      else next.add(partNumber)
      return next
    })
  }

  const filteredParts = bomData.filter((item) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      item.partNumber.toLowerCase().includes(term) ||
      item.product.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term)
    )
  })

  const compareItems = bomData.filter(i => compareSet.has(i.partNumber))

  // Cost drivers for selected part
  const costDrivers = selectedPart
    ? [...selectedPart.components]
        .map(c => ({ ...c, lineCost: c.quantity * c.costPerUnit }))
        .filter(c => c.lineCost > 0)
        .sort((a, b) => b.lineCost - a.lineCost)
        .slice(0, 10)
    : []
  const maxDriverCost = costDrivers.length > 0 ? costDrivers[0].lineCost : 1

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

      {/* Comparison View */}
      {showCompare && compareItems.length >= 2 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="size-4" /> Comparison ({compareItems.length} items)
              </CardTitle>
              <button onClick={() => setShowCompare(false)} className="p-1 hover:bg-muted rounded">
                <X className="size-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4">Part</th>
                    <th className="text-left py-2 pr-4">Category</th>
                    <th className="text-right py-2 pr-4">Total</th>
                    <th className="text-right py-2 pr-4">Material</th>
                    <th className="text-right py-2 pr-4">Packaging</th>
                    <th className="text-right py-2 pr-4">Labor/Energy</th>
                  </tr>
                </thead>
                <tbody>
                  {compareItems.map(item => {
                    const minTotal = Math.min(...compareItems.map(i => i.totalCost))
                    const maxTotal = Math.max(...compareItems.map(i => i.totalCost))
                    return (
                      <tr key={item.partNumber} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <p className="font-medium">{item.partNumber}</p>
                          <p className="text-xs text-muted-foreground">{item.product}</p>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{item.category}</td>
                        <td className={`py-2 pr-4 text-right font-medium ${
                          item.totalCost === minTotal && compareItems.length > 1 ? 'text-green-600' :
                          item.totalCost === maxTotal && compareItems.length > 1 ? 'text-red-500' : ''
                        }`}>
                          ${item.totalCost.toFixed(2)}
                        </td>
                        <td className="py-2 pr-4 text-right text-amber-600">${item.materialCost.toFixed(2)}</td>
                        <td className="py-2 pr-4 text-right text-slate-600">${item.packagingCost.toFixed(2)}</td>
                        <td className="py-2 pr-4 text-right text-purple-600">${item.laborEnergyCost.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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

              {compareSet.size >= 2 && (
                <button
                  onClick={() => setShowCompare(true)}
                  className="w-full mb-3 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Compare Selected ({compareSet.size})
                </button>
              )}

              <div className="max-h-[500px] overflow-y-auto space-y-1">
                {filteredParts.map((item) => (
                  <div key={item.partNumber} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={compareSet.has(item.partNumber)}
                      onChange={() => toggleCompare(item.partNumber)}
                      className="shrink-0 rounded border-muted-foreground/30"
                    />
                    <button
                      onClick={() => setSelectedPart(item)}
                      className={`flex-1 text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between ${
                        selectedPart?.partNumber === item.partNumber
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{item.partNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.product} · ${item.totalCost.toFixed(2)}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    </button>
                  </div>
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
                        <p className="text-xs text-muted-foreground mt-1">
                          {selectedPart.category} · {selectedPart.qtyPerPallet} per pallet
                        </p>
                      </div>
                      <div className="text-right space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Total Cost</p>
                          <p className="text-2xl font-bold text-green-600">
                            ${selectedPart.totalCost.toFixed(2)}
                          </p>
                        </div>
                        <button
                          onClick={() => { setDuplicateMsg(true); setTimeout(() => setDuplicateMsg(false), 3000) }}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors"
                        >
                          <Copy className="size-3" /> Duplicate
                        </button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {/* Duplicate coming soon toast */}
                {duplicateMsg && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm text-blue-400">
                    🚧 BOM editing coming soon — duplicating will be available when BOMs are managed in the dashboard.
                  </div>
                )}

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
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Raw Materials</p>
                          <p className="text-lg font-semibold text-amber-600">
                            ${selectedPart.materialCost.toFixed(2)}
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
                          <p className="text-xs text-muted-foreground">Packaging</p>
                          <p className="text-lg font-semibold text-slate-600">
                            ${selectedPart.packagingCost.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Labor/Energy</p>
                          <p className="text-lg font-semibold text-purple-600">
                            ${selectedPart.laborEnergyCost.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Cost Analysis - Top Cost Drivers */}
                {costDrivers.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <BarChart3 className="size-4" />
                        Top Cost Drivers
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {costDrivers.map((driver, idx) => {
                          const pct = selectedPart.totalCost > 0
                            ? (driver.lineCost / selectedPart.totalCost) * 100
                            : 0
                          const barWidth = maxDriverCost > 0
                            ? (driver.lineCost / maxDriverCost) * 100
                            : 0
                          return (
                            <div key={driver.partNumber + idx}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-sm font-medium truncate">{driver.partNumber}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getCategoryColor(driver.category)}`}>
                                    {getCategoryLabel(driver.category)}
                                  </span>
                                </div>
                                <div className="text-right text-sm shrink-0 ml-2">
                                  <span className="font-medium">${driver.lineCost.toFixed(2)}</span>
                                  <span className="text-muted-foreground ml-1">({pct.toFixed(1)}%)</span>
                                </div>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${barColors[driver.category] || 'bg-gray-500'}`}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
