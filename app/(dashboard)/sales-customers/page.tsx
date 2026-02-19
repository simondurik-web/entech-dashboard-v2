'use client'

import { useEffect, useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, ArrowUpDown } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface SalesOrder {
  line: string
  customer: string
  partNumber: string
  category: string
  qty: number
  revenue: number
  variableCost: number
  totalCost: number
  pl: number
  shippedDate: string
  status: string
}

interface SalesData {
  orders: SalesOrder[]
  summary: { totalRevenue: number; totalCosts: number; totalPL: number; avgMargin: number; orderCount: number }
}

interface CustomerSummary {
  customer: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
  orders: SalesOrder[]
}

type SortField = 'customer' | 'orderCount' | 'totalQty' | 'revenue' | 'costs' | 'pl' | 'margin'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

const CATEGORY_CLASSES: Record<string, string> = {
  'Roll Tech': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  'Molding': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  'Snap Pad': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  'Other': 'bg-gray-500/20 text-gray-400 border-gray-500/50',
}

export default function SalesCustomersPage() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField>('pl')
  const [sortAsc, setSortAsc] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const { t } = useI18n()

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/sales')
        if (!res.ok) throw new Error('Failed to fetch sales data')
        const salesData = await res.json()
        setData(salesData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const customerSummaries = useMemo(() => {
    if (!data) return []
    
    const byCustomer: Record<string, CustomerSummary> = {}
    
    for (const order of data.orders) {
      const key = order.customer || 'Unknown'
      if (!byCustomer[key]) {
        byCustomer[key] = {
          customer: key,
          orderCount: 0,
          totalQty: 0,
          revenue: 0,
          costs: 0,
          pl: 0,
          margin: 0,
          orders: [],
        }
      }
      byCustomer[key].orderCount++
      byCustomer[key].totalQty += order.qty
      byCustomer[key].revenue += order.revenue
      byCustomer[key].costs += order.totalCost || order.variableCost
      byCustomer[key].pl += order.pl
      byCustomer[key].orders.push(order)
    }
    
    // Calculate margin and sort
    let summaries = Object.values(byCustomer).map((c) => ({
      ...c,
      margin: c.revenue > 0 ? (c.pl / c.revenue) * 100 : 0,
    }))
    
    // Filter by search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      summaries = summaries.filter((c) => c.customer.toLowerCase().includes(term))
    }
    
    // Sort
    summaries.sort((a, b) => {
      const multiplier = sortAsc ? 1 : -1
      switch (sortField) {
        case 'customer': return multiplier * a.customer.localeCompare(b.customer)
        case 'orderCount': return multiplier * (a.orderCount - b.orderCount)
        case 'totalQty': return multiplier * (a.totalQty - b.totalQty)
        case 'revenue': return multiplier * (a.revenue - b.revenue)
        case 'costs': return multiplier * (a.costs - b.costs)
        case 'pl': return multiplier * (a.pl - b.pl)
        case 'margin': return multiplier * (a.margin - b.margin)
        default: return 0
      }
    })
    
    return summaries
  }, [data, sortField, sortAsc, searchTerm])

  function toggleExpand(customer: string) {
    setExpandedCustomers((prev) => {
      const next = new Set(prev)
      if (next.has(customer)) {
        next.delete(customer)
      } else {
        next.add(customer)
      }
      return next
    })
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(field === 'customer')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">{t('ui.loading')}</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">{error || 'Failed to load'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('page.salesByCustomer')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.salesByCustomerSubtitle')}</p>
        </div>
        <input
          type="text"
          placeholder={t('ui.search')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full md:w-64 rounded-lg border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-3 py-3 text-left font-medium w-8"></th>
                <th className="px-3 py-3 text-left font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('customer')}>
                  <span className="flex items-center gap-1">{t('table.customer')} <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-3 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('orderCount')}>
                  <span className="flex items-center justify-end gap-1">{t('table.orders')} <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-3 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('totalQty')}>
                  <span className="flex items-center justify-end gap-1">{t('table.qty')} <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-3 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('revenue')}>
                  <span className="flex items-center justify-end gap-1">{t('table.revenue')} <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-3 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('costs')}>
                  <span className="flex items-center justify-end gap-1">{t('salesOverview.totalCosts')} <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-3 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('pl')}>
                  <span className="flex items-center justify-end gap-1">P/L <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-3 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('margin')}>
                  <span className="flex items-center justify-end gap-1">{t('salesOverview.avgMargin')} <ArrowUpDown className="h-3 w-3" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {customerSummaries.map((cust) => (
                <>
                  <tr 
                    key={cust.customer} 
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggleExpand(cust.customer)}
                  >
                    <td className="px-3 py-3">
                      {expandedCustomers.has(cust.customer) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>
                    <td className="px-3 py-3 font-medium">{cust.customer}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(cust.orderCount)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(cust.totalQty)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(cust.revenue)}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(cust.costs)}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${cust.pl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatCurrency(cust.pl)}
                    </td>
                    <td className={`px-3 py-3 text-right font-semibold ${cust.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {cust.margin.toFixed(1)}%
                    </td>
                  </tr>
                  {expandedCustomers.has(cust.customer) && (
                    <tr key={`${cust.customer}-expanded`}>
                      <td colSpan={8} className="bg-muted/20 px-6 py-3">
                        <div className="text-xs space-y-2">
                          <p className="font-semibold text-muted-foreground mb-2">{t('salesCustomers.ordersByPart')}:</p>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-left px-2 py-1">{t('table.line')}</th>
                                  <th className="text-left px-2 py-1">{t('table.partNumber')}</th>
                                  <th className="text-left px-2 py-1">{t('table.category')}</th>
                                  <th className="text-right px-2 py-1">{t('table.qty')}</th>
                                  <th className="text-right px-2 py-1">{t('table.revenue')}</th>
                                  <th className="text-right px-2 py-1">P/L</th>
                                  <th className="text-left px-2 py-1">{t('status.shipped')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cust.orders.slice(0, 10).map((order, idx) => (
                                  <tr key={`${order.line}-${idx}`} className="border-t border-border/50">
                                    <td className="px-2 py-1">{order.line}</td>
                                    <td className="px-2 py-1 font-medium">{order.partNumber}</td>
                                    <td className="px-2 py-1">
                                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CATEGORY_CLASSES[order.category] || CATEGORY_CLASSES['Other']}`}>
                                        {order.category}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1 text-right">{formatNumber(order.qty)}</td>
                                    <td className="px-2 py-1 text-right">{formatCurrency(order.revenue)}</td>
                                    <td className={`px-2 py-1 text-right ${order.pl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                      {formatCurrency(order.pl)}
                                    </td>
                                    <td className="px-2 py-1">{order.shippedDate}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {cust.orders.length > 10 && (
                              <p className="text-muted-foreground mt-2">...and {cust.orders.length - 10} more orders</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
