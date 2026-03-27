'use client'

import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'

interface CustomerData {
  customer: string
  revenue: number
  totalMarginPct: number
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  customers: CustomerData[]
}

export function TopCustomersBarChart({ customers }: Props) {
  const top10 = useMemo(
    () => [...customers].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    [customers]
  )

  if (top10.length === 0) return null

  const chartHeight = Math.max(top10.length * 38 + 48, 200)

  return (
    <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-5 shadow-lg">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
        Top 10 Customers by Revenue
      </h3>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 90, bottom: 0, left: 10 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.2}
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis
              type="category"
              dataKey="customer"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={130}
              tickFormatter={(v: string) => (v.length > 16 ? v.slice(0, 16) + '…' : v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
                padding: '8px 12px',
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(...args: any[]) => {
                const value = args[0] as number
                const props = args[2]
                const margin: number = props?.payload?.totalMarginPct ?? 0
                return [`${fmt(value)}  (${margin.toFixed(1)}% margin)`, 'Revenue']
              }}
            />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]} animationBegin={0} animationDuration={800}>
              {top10.map((entry) => (
                <Cell
                  key={entry.customer}
                  fill={
                    entry.totalMarginPct >= 0
                      ? 'rgba(16,185,129,0.7)'
                      : 'rgba(239,68,68,0.7)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
