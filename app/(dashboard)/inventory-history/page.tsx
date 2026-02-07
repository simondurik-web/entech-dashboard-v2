'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem } from '@/lib/google-sheets'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'

// Generate mock historical data for demo
function generateMockHistory(items: InventoryItem[]) {
  const days = 30
  const now = new Date()
  const history: Array<{ date: string; [key: string]: string | number }> = []

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`
    const entry: { date: string; [key: string]: string | number } = { date: dateStr }

    // Add stock levels for top items with some random variation
    items.slice(0, 5).forEach((item) => {
      const baseStock = item.inStock
      const variation = Math.floor(Math.random() * 50) - 25
      entry[item.partNumber] = Math.max(0, baseStock + variation + (days - i) * 2)
    })

    history.push(entry)
  }

  return history
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

export default function InventoryHistoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedParts, setSelectedParts] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetch('/api/inventory')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch inventory')
        return res.json()
      })
      .then((data: InventoryItem[]) => {
        // Sort by stock level descending
        const sorted = data.sort((a, b) => b.inStock - a.inStock)
        setInventory(sorted)
        // Auto-select top 3 parts
        setSelectedParts(sorted.slice(0, 3).map((i) => i.partNumber))
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filteredParts = inventory.filter((item) =>
    item.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.product.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const togglePart = (partNumber: string) => {
    setSelectedParts((prev) =>
      prev.includes(partNumber)
        ? prev.filter((p) => p !== partNumber)
        : prev.length < 5
        ? [...prev, partNumber]
        : prev
    )
  }

  // Generate chart data for selected parts
  const selectedItems = inventory.filter((i) => selectedParts.includes(i.partNumber))
  const historyData = generateMockHistory(selectedItems)

  // Current stock comparison chart data
  const comparisonData = selectedItems.map((item) => ({
    name: item.partNumber.length > 15 ? item.partNumber.slice(0, 15) + '...' : item.partNumber,
    stock: item.inStock,
    minimum: item.minimum,
    target: item.target || item.minimum * 1.5,
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return <p className="text-center text-destructive py-10">{error}</p>
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📈 Inventory History</h1>
      <p className="text-muted-foreground text-sm mb-4">Track stock levels over time</p>

      <div className="grid lg:grid-cols-4 gap-4">
        {/* Part selector panel */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Select Parts (max 5)</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="text"
              placeholder="Search parts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background mb-3"
            />
            <div className="max-h-[400px] overflow-y-auto space-y-1">
              {filteredParts.slice(0, 50).map((item) => {
                const isSelected = selectedParts.includes(item.partNumber)
                const colorIdx = selectedParts.indexOf(item.partNumber)
                return (
                  <button
                    key={item.partNumber}
                    onClick={() => togglePart(item.partNumber)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2 ${
                      isSelected
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {isSelected && (
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[colorIdx] }}
                      />
                    )}
                    <span className="truncate">{item.partNumber}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {item.inStock}
                    </span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Charts area */}
        <div className="lg:col-span-3 space-y-4">
          {/* Line chart - Historical trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">30-Day Stock Trend</CardTitle>
              <p className="text-xs text-muted-foreground">
                Demo data — will connect to actual history when available
              </p>
            </CardHeader>
            <CardContent>
              {selectedParts.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">
                  Select parts from the left panel to view trends
                </p>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      {selectedParts.map((part, idx) => (
                        <Line
                          key={part}
                          type="monotone"
                          dataKey={part}
                          stroke={COLORS[idx]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bar chart - Current stock vs minimum/target */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Stock vs Minimum/Target</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedParts.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">
                  Select parts to compare stock levels
                </p>
              ) : (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="stock" name="Current Stock" fill="#3b82f6" />
                      <Bar dataKey="minimum" name="Minimum" fill="#ef4444" />
                      <Bar dataKey="target" name="Target" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick stats for selected parts */}
          {selectedParts.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {selectedItems.map((item, idx) => (
                <Card
                  key={item.partNumber}
                  className="border-l-4"
                  style={{ borderLeftColor: COLORS[idx] }}
                >
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground truncate">{item.partNumber}</p>
                    <p className="text-2xl font-bold">{item.inStock.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">
                      Min: {item.minimum} | Target: {item.target || '-'}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
