'use client'

import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { ArrowUpDown, Search, Package, Eye } from 'lucide-react'
import type { LabelData } from '@/lib/label-utils'

interface OrderOption {
  line: string
  customer: string
  partNumber: string
  orderQty: number
  poNumber: string
  ifNumber: string
  partsPerPackage: number
  labelStatus: string | null  // null = no label exists
}

type SortField = 'line' | 'customer' | 'partNumber' | 'orderQty' | 'poNumber' | 'ifNumber'
type SortDir = 'asc' | 'desc'

interface GenerateLabelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: (label?: LabelData) => void
}

export function GenerateLabelsDialog({ open, onOpenChange, onGenerated }: GenerateLabelsDialogProps) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderOption[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('line')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  // Custom parts-per-package overrides (line -> value)
  const [customPPP, setCustomPPP] = useState<Record<string, number>>({})
  // Expanded row for detail editing
  const [expandedLine, setExpandedLine] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setSearch('')
    setExpandedLine(null)
    setCustomPPP({})

    // Fetch ALL orders + existing labels
    Promise.all([
      fetch('/api/sheets').then(r => r.json()),
      fetch('/api/labels').then(r => r.json()),
    ])
      .then(([allOrders, existingLabels]) => {
        const labelMap = new Map<string, string>()
        for (const l of existingLabels as Array<{ order_line: string; label_status: string }>) {
          labelMap.set(l.order_line, l.label_status)
        }

        const mapped = (allOrders as Array<Record<string, unknown>>)
          .filter((o) => {
            const status = String(o.internalStatus || o.internal_status || '').toLowerCase()
            return !status.includes('shipped') && !status.includes('cancel')
          })
          .map((o): OrderOption => ({
            line: String(o.line || ''),
            customer: String(o.customer || ''),
            partNumber: String(o.partNumber || o.part_number || ''),
            orderQty: Number(o.orderQty || o.order_qty || 0),
            poNumber: String(o.poNumber || o.po_number || ''),
            ifNumber: String(o.ifNumber || o.if_number || ''),
            partsPerPackage: Number(o.partsPerPackage || o.parts_per_package || 0),
            labelStatus: labelMap.get(String(o.line || '')) ?? null,
          }))
        setOrders(mapped)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  // Filter
  const filtered = useMemo(() => {
    let list = orders
    if (search) {
      const s = search.toLowerCase()
      list = list.filter((o) =>
        o.line.toLowerCase().includes(s) ||
        o.customer.toLowerCase().includes(s) ||
        o.partNumber.toLowerCase().includes(s) ||
        o.poNumber.toLowerCase().includes(s) ||
        o.ifNumber.toLowerCase().includes(s)
      )
    }
    // Sort
    list = [...list].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [orders, search, sortField, sortDir])

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-3 py-2 text-left cursor-pointer select-none hover:bg-muted/70 ${className || ''}`}
      onClick={() => toggleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className={`size-3 ${sortField === field ? 'opacity-100' : 'opacity-30'}`} />
      </span>
    </th>
  )

  const getEffectivePPP = (o: OrderOption) => customPPP[o.line] ?? o.partsPerPackage
  const getNumPackages = (o: OrderOption) => {
    const ppp = getEffectivePPP(o)
    if (ppp <= 0 || o.orderQty <= 0) return 0
    return Math.ceil(o.orderQty / ppp)
  }

  const handleGenerate = async (order: OrderOption) => {
    setGenerating(order.line)
    setError(null)

    try {
      const ppp = getEffectivePPP(order)
      const isRegenerate = order.labelStatus !== null

      // If regenerating, delete old label first
      if (isRegenerate) {
        await fetch(`/api/labels?order_line=${encodeURIComponent(order.line)}`, {
          method: 'DELETE',
          headers: user ? { 'x-user-id': user.id } : {},
        })
      }

      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user ? { 'x-user-id': user.id } : {}),
        },
        body: JSON.stringify({
          order_lines: [order.line],
          ...(ppp !== order.partsPerPackage ? { custom_parts_per_package: { [order.line]: ppp } } : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate label')
      }

      const data = await res.json()
      const generatedLabel = data.results?.[0]?.labels?.[0] as LabelData | undefined

      // Update the local state
      setOrders(prev => prev.map(o =>
        o.line === order.line ? { ...o, labelStatus: 'generated' } : o
      ))

      onGenerated(generatedLabel)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(null)
    }
  }

  const statusBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline" className="text-xs">No Label</Badge>
    switch (status) {
      case 'printed': return <Badge className="bg-green-500/20 text-green-600 text-xs">Printed</Badge>
      case 'generated': return <Badge className="bg-blue-500/20 text-blue-600 text-xs">Generated</Badge>
      case 'emailed': return <Badge className="bg-purple-500/20 text-purple-600 text-xs">Emailed</Badge>
      default: return <Badge variant="outline" className="text-xs">{status}</Badge>
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[95vw] w-[95vw] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-5" />
            Generate Labels
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by line #, customer, part number, PO, or IF#..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        )}

        {error && <p className="text-sm text-destructive py-2">{error}</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No orders found matching your search.
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <SortHeader field="line" className="w-20">Line</SortHeader>
                  <SortHeader field="customer">Customer</SortHeader>
                  <SortHeader field="partNumber">Part #</SortHeader>
                  <SortHeader field="poNumber">PO #</SortHeader>
                  <SortHeader field="ifNumber">IF #</SortHeader>
                  <SortHeader field="orderQty" className="text-right">Qty</SortHeader>
                  <th className="px-3 py-2 text-center w-20">Pkg</th>
                  <th className="px-3 py-2 text-center w-24">Status</th>
                  <th className="px-3 py-2 text-center w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const isExpanded = expandedLine === o.line
                  const ppp = getEffectivePPP(o)
                  const numPkg = getNumPackages(o)
                  const isCustom = customPPP[o.line] != null && customPPP[o.line] !== o.partsPerPackage
                  const isGenerating = generating === o.line

                  return (
                    <tr
                      key={o.line}
                      className={`border-t hover:bg-muted/30 cursor-pointer ${isExpanded ? 'bg-muted/20' : ''}`}
                      onClick={() => setExpandedLine(isExpanded ? null : o.line)}
                    >
                      <td className="px-3 py-2 font-medium">{o.line}</td>
                      <td className="px-3 py-2">{o.customer}</td>
                      <td className="px-3 py-2">{o.partNumber}</td>
                      <td className="px-3 py-2 text-muted-foreground">{o.poNumber || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{o.ifNumber || '—'}</td>
                      <td className="px-3 py-2 text-right">{o.orderQty.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={isCustom ? 'text-orange-500 font-semibold' : ''}>
                          {numPkg > 0 ? numPkg : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">{statusBadge(o.labelStatus)}</td>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant={o.labelStatus ? 'outline' : 'default'}
                          className="h-7 text-xs"
                          disabled={isGenerating || ppp <= 0}
                          onClick={() => handleGenerate(o)}
                        >
                          {isGenerating
                            ? '...'
                            : o.labelStatus
                              ? 'Regenerate'
                              : 'Generate'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Expanded row — custom packaging editor */}
        {expandedLine && (() => {
          const order = orders.find(o => o.line === expandedLine)
          if (!order) return null
          const ppp = getEffectivePPP(order)
          const numPkg = getNumPackages(order)
          const lastPkgQty = order.orderQty > 0 && ppp > 0
            ? order.orderQty % ppp === 0 ? ppp : order.orderQty % ppp
            : 0

          return (
            <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">
                  Line {order.line} — {order.customer}
                </h4>
                <Badge variant="outline" className="text-xs">
                  {order.partNumber}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="text-muted-foreground text-xs block mb-1">Order Qty</label>
                  <div className="font-medium">{order.orderQty.toLocaleString()}</div>
                </div>
                <div>
                  <label className="text-muted-foreground text-xs block mb-1">
                    Parts per Package
                    {order.partsPerPackage > 0 && (
                      <span className="ml-1 text-[10px]">(std: {order.partsPerPackage})</span>
                    )}
                  </label>
                  <Input
                    type="number"
                    className="h-8 w-28"
                    value={ppp || ''}
                    min={1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      if (!isNaN(val) && val > 0) {
                        setCustomPPP(prev => ({ ...prev, [order.line]: val }))
                      } else if (e.target.value === '') {
                        setCustomPPP(prev => {
                          const next = { ...prev }
                          delete next[order.line]
                          return next
                        })
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-muted-foreground text-xs block mb-1">Result</label>
                  <div className="font-medium">
                    {numPkg > 0 ? (
                      <>
                        {numPkg} package{numPkg !== 1 ? 's' : ''}
                        {lastPkgQty !== ppp && (
                          <span className="text-muted-foreground text-xs ml-1">
                            (last: {lastPkgQty})
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Set parts per package</span>
                    )}
                  </div>
                </div>
              </div>

              {order.poNumber && (
                <div className="text-xs text-muted-foreground">PO: {order.poNumber} {order.ifNumber ? `· IF: ${order.ifNumber}` : ''}</div>
              )}
            </div>
          )
        })()}

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-muted-foreground">
              {filtered.length} order{filtered.length !== 1 ? 's' : ''} shown
            </span>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('ui.close')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
