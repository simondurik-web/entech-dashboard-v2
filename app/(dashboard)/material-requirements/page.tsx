'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { MaterialRequirementsData, MaterialRequirement } from '@/app/api/material-requirements/route'
import { useI18n } from '@/lib/i18n'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'roll tech', label: 'Roll Tech' },
  { key: 'molding', label: 'Molding' },
  { key: 'snap pad', label: 'Snap Pad' },
] as const

type CategoryFilter = (typeof CATEGORY_FILTERS)[number]['key']

function statusBadge(status: 'ok' | 'low' | 'shortage') {
  switch (status) {
    case 'shortage':
      return { bg: 'bg-red-500/20 text-red-600', label: 'SHORTAGE' }
    case 'low':
      return { bg: 'bg-yellow-500/20 text-yellow-600', label: 'LOW' }
    default:
      return { bg: 'bg-green-500/20 text-green-600', label: 'OK' }
  }
}

function coverageBar(coverage: number) {
  if (coverage >= 80) return 'bg-green-500'
  if (coverage >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

export default function MaterialRequirementsPage() {
  const [data, setData] = useState<MaterialRequirementsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const { t } = useI18n()

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/material-requirements')
      if (!res.ok) throw new Error('Failed to fetch material requirements')
      const result = await res.json()
      setData(result)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredMaterials = useMemo(() => {
    if (!data) return []
    let materials = data.materials
    if (categoryFilter !== 'all') {
      materials = materials.filter(m => m.category.toLowerCase().includes(categoryFilter))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      materials = materials.filter(m => m.name.toLowerCase().includes(q))
    }
    return materials
  }, [data, categoryFilter, search])

  function exportCSV() {
    if (!data) return
    let csv = 'Material,On Hand,Needed,Surplus/Shortage,Coverage %,Status,Category\n'
    data.materials.forEach(m => {
      csv += `"${m.name}",${m.onHand},${m.needed},${m.surplus},${m.coverage}%,${m.status},"${m.category}"\n`
    })
    csv += '\nHub,Category,Qty Needed,Weight/ea\n'
    data.hubs.forEach(h => {
      csv += `"${h.part}","${h.category}",${h.qty},${h.weight}\n`
    })
    csv += '\nTire,Qty Needed,Weight/ea\n'
    data.tires.forEach(t => {
      csv += `"${t.part}",${t.qty},${t.weight}\n`
    })
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `material-requirements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📦 {t('page.materialReqs')}</h1>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:inline">Updated: {lastUpdated}</span>
          )}
          <button
            onClick={exportCSV}
            disabled={!data}
            className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
            aria-label="Export CSV"
          >
            <Download className="size-5" />
          </button>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <p className="text-muted-foreground text-sm mb-4">{t('page.materialReqsSubtitle')}</p>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Open Orders</p>
            <p className="text-xl font-bold">{data.totalOpenOrders.toLocaleString()}</p>
          </div>
          <div className="bg-blue-500/10 rounded-lg p-3">
            <p className="text-xs text-blue-600">Hubs Needed</p>
            <p className="text-xl font-bold text-blue-600">{data.totalHubs.toLocaleString()}</p>
          </div>
          <div className="bg-purple-500/10 rounded-lg p-3">
            <p className="text-xs text-purple-600">Tires Needed</p>
            <p className="text-xl font-bold text-purple-600">{data.totalTires.toLocaleString()}</p>
          </div>
          <div className={`rounded-lg p-3 ${data.shortageCount > 0 ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
            <p className={`text-xs ${data.shortageCount > 0 ? 'text-red-500' : 'text-green-600'}`}>Shortages</p>
            <p className={`text-xl font-bold ${data.shortageCount > 0 ? 'text-red-500' : 'text-green-600'}`}>{data.shortageCount}</p>
          </div>
          <div className="bg-amber-500/10 rounded-lg p-3">
            <p className="text-xs text-amber-600">Urethane Needed</p>
            <p className="text-lg font-bold text-amber-600">{data.totalUrethane.toLocaleString()} lbs</p>
          </div>
          <div className="bg-orange-500/10 rounded-lg p-3">
            <p className="text-xs text-orange-600">Crumb Rubber</p>
            <p className="text-lg font-bold text-orange-600">{data.totalCrumbRubber.toLocaleString()} lbs</p>
          </div>
        </div>
      )}

      {/* Search */}
      <Input
        type="text"
        placeholder={t('ui.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
      />

      {/* Category filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCategoryFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {f.key === 'all' ? t('category.all') : f.key === 'roll tech' ? t('category.rollTech') : f.key === 'molding' ? t('category.molding') : t('category.snappad')}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {/* Material Status Table */}
      {!loading && !error && data && (
        <>
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-1">📊 Material Inventory vs. Demand</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {filteredMaterials.length} material{filteredMaterials.length !== 1 ? 's' : ''} · Click a row for demand breakdown
            </p>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 font-medium">Material</th>
                    <th className="text-left p-3 font-medium">Category</th>
                    <th className="text-right p-3 font-medium">On Hand</th>
                    <th className="text-right p-3 font-medium">Needed</th>
                    <th className="text-right p-3 font-medium">Surplus/Shortage</th>
                    <th className="p-3 font-medium" style={{ minWidth: 140 }}>Coverage</th>
                    <th className="text-center p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.map((mat) => {
                    const badge = statusBadge(mat.status)
                    const isExpanded = expandedMaterial === mat.name
                    return (
                      <>
                        <tr
                          key={mat.name}
                          className={`border-t cursor-pointer transition-colors hover:bg-muted/50 ${
                            mat.status === 'shortage' ? 'bg-red-500/5' :
                            mat.status === 'low' ? 'bg-yellow-500/5' : ''
                          }`}
                          onClick={() => setExpandedMaterial(isExpanded ? null : mat.name)}
                        >
                          <td className="p-3 font-medium">
                            <div className="flex items-center gap-1.5">
                              {isExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                              {mat.name}
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">{mat.category !== 'Other' ? mat.category : '—'}</td>
                          <td className="p-3 text-right font-medium">{mat.onHand.toLocaleString()}</td>
                          <td className="p-3 text-right">{mat.needed.toLocaleString()}</td>
                          <td className={`p-3 text-right font-semibold ${mat.surplus >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {mat.surplus >= 0 ? '+' : ''}{mat.surplus.toLocaleString()}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${coverageBar(mat.coverage)}`}
                                  style={{ width: `${Math.min(mat.coverage, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium w-8 text-right">{mat.coverage}%</span>
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 text-xs rounded ${badge.bg}`}>{badge.label}</span>
                          </td>
                        </tr>
                        {isExpanded && mat.sources.length > 0 && (
                          <tr key={`${mat.name}-detail`}>
                            <td colSpan={7} className="p-0">
                              <div className="bg-muted/30 px-6 py-3 border-t">
                                <p className="text-xs font-medium text-muted-foreground mb-2">DEMAND BREAKDOWN</p>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-muted-foreground text-xs">
                                      <th className="pb-1">Component</th>
                                      <th className="pb-1">Type</th>
                                      <th className="pb-1 text-right">Units</th>
                                      <th className="pb-1 text-right">Lbs/Unit</th>
                                      <th className="pb-1 text-right">Total Lbs</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(() => {
                                      const grouped = new Map<string, { qty: number; materialPerUnit: number; totalLbs: number; sourceLabel: string }>()
                                      for (const s of mat.sources) {
                                        const existing = grouped.get(s.component)
                                        if (existing) {
                                          existing.qty += s.qty
                                          existing.totalLbs += s.totalLbs
                                        } else {
                                          grouped.set(s.component, { ...s })
                                        }
                                      }
                                      return Array.from(grouped.entries()).map(([comp, info]) => (
                                        <tr key={comp} className="border-t border-muted/50">
                                          <td className="py-1">{comp}</td>
                                          <td className="py-1">{info.sourceLabel}</td>
                                          <td className="py-1 text-right">{info.qty.toLocaleString()}</td>
                                          <td className="py-1 text-right">{info.materialPerUnit.toFixed(3)}</td>
                                          <td className="py-1 text-right">{Math.round(info.totalLbs).toLocaleString()}</td>
                                        </tr>
                                      ))
                                    })()}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
              {filteredMaterials.length === 0 && (
                <p className="text-center text-muted-foreground py-10">No materials found</p>
              )}
            </div>
          </div>

          {/* Hub Breakdown */}
          {data.hubs.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">🔧 Hub Production Breakdown</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3">Hub Part</th>
                      <th className="text-left p-3">Type</th>
                      <th className="text-right p-3">Qty Needed</th>
                      <th className="text-right p-3">Wt/ea (lbs)</th>
                      <th className="text-left p-3">Materials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.hubs.map((hub) => (
                      <tr key={hub.part} className="border-t">
                        <td className="p-3 font-medium">{hub.part}</td>
                        <td className="p-3">{hub.category}</td>
                        <td className="p-3 text-right">{hub.qty.toLocaleString()}</td>
                        <td className="p-3 text-right">{hub.weight.toFixed(2)}</td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {hub.materials.map(m => `${m.name} (${m.total.toLocaleString()} lbs)`).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tire Breakdown */}
          {data.tires.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">🛞 Tire Production Breakdown</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3">Tire Size</th>
                      <th className="text-right p-3">Qty Needed</th>
                      <th className="text-right p-3">Wt/ea (lbs)</th>
                      <th className="text-right p-3">Crumb Rubber (lbs)</th>
                      <th className="text-right p-3">Urethane (lbs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tires.map((tire) => {
                      const crumb = tire.materials.find(m => m.name.toLowerCase().includes('abr'))
                      const urethane = tire.materials.find(m => m.name.toLowerCase().includes('urth'))
                      return (
                        <tr key={tire.part} className="border-t">
                          <td className="p-3 font-medium">{tire.part}</td>
                          <td className="p-3 text-right">{tire.qty.toLocaleString()}</td>
                          <td className="p-3 text-right">{tire.weight.toFixed(2)}</td>
                          <td className="p-3 text-right">{crumb ? crumb.total.toLocaleString() : '—'}</td>
                          <td className="p-3 text-right">{urethane ? urethane.total.toLocaleString() : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
