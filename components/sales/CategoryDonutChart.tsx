'use client'

import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface SalesOrder {
  category: string
  revenue: number
}

const CATEGORY_COLORS: Record<string, string> = {
  'Roll Tech': '#3b82f6',
  'Molding': '#eab308',
  'Snap Pad': '#a855f7',
  'Other': '#6b7280',
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  orders: SalesOrder[]
}

export function CategoryDonutChart({ orders }: Props) {
  const data = useMemo(() => {
    const byCategory: Record<string, number> = {}
    for (const o of orders) {
      const cat = o.category || 'Other'
      byCategory[cat] = (byCategory[cat] || 0) + o.revenue
    }
    return Object.entries(byCategory)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [orders])

  const totalRevenue = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data])

  if (data.length === 0) return null

  return (
    <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-5 shadow-lg">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Revenue by Category</h3>
      <div className="flex items-center gap-6 flex-wrap">
        <div className="relative flex-shrink-0" style={{ width: 180, height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={82}
                paddingAngle={2}
                dataKey="value"
                animationBegin={0}
                animationDuration={800}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={CATEGORY_COLORS[entry.name] || CATEGORY_COLORS['Other']}
                    opacity={0.85}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                  padding: '8px 12px',
                }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [fmt(value as number), 'Revenue']}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[10px] text-muted-foreground">Total</p>
            <p className="text-sm font-bold leading-tight">{fmt(totalRevenue)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 flex-1 min-w-[160px]">
          {data.map((entry) => {
            const pct = totalRevenue > 0 ? (entry.value / totalRevenue) * 100 : 0
            return (
              <div key={entry.name} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: CATEGORY_COLORS[entry.name] || CATEGORY_COLORS['Other'] }}
                />
                <span className="text-xs text-muted-foreground flex-1">{entry.name}</span>
                <span className="text-xs font-semibold">{fmt(entry.value)}</span>
                <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
