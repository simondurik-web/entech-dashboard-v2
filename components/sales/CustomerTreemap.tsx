'use client'

import { useMemo } from 'react'
import { Treemap, ResponsiveContainer } from 'recharts'

interface CustomerData {
  customer: string
  revenue: number
  totalMarginPct: number
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function getColor(margin: number): string {
  if (margin >= 20) return 'rgba(16,185,129,0.80)'
  if (margin >= 10) return 'rgba(16,185,129,0.55)'
  if (margin >= 0) return 'rgba(16,185,129,0.30)'
  if (margin >= -10) return 'rgba(239,68,68,0.35)'
  return 'rgba(239,68,68,0.75)'
}

interface Props {
  customers: CustomerData[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TreemapCell(props: any) {
  const { x = 0, y = 0, width = 0, height = 0, name = '', value = 0, margin = 0 } = props
  const color = getColor(margin as number)
  const showLabel = (width as number) > 50 && (height as number) > 24
  const showSub = (height as number) > 42 && (width as number) > 50
  const fontSize = Math.min(11, Math.max(8, (width as number) / 8))
  return (
    <g>
      <rect
        x={(x as number) + 1}
        y={(y as number) + 1}
        width={(width as number) - 2}
        height={(height as number) - 2}
        fill={color}
        rx={4}
        style={{ cursor: 'default' }}
      />
      {showLabel && (
        <text
          x={(x as number) + (width as number) / 2}
          y={(y as number) + (height as number) / 2 - (showSub ? 7 : 0)}
          textAnchor="middle"
          fill="rgba(255,255,255,0.92)"
          fontSize={fontSize}
          fontWeight={600}
          dominantBaseline="middle"
        >
          {(name as string).length > 14 ? (name as string).slice(0, 14) + '…' : name}
        </text>
      )}
      {showSub && (
        <text
          x={(x as number) + (width as number) / 2}
          y={(y as number) + (height as number) / 2 + 9}
          textAnchor="middle"
          fill="rgba(255,255,255,0.60)"
          fontSize={9}
          dominantBaseline="middle"
        >
          {fmt(value as number)}
        </text>
      )}
    </g>
  )
}

export function CustomerTreemap({ customers }: Props) {
  const data = useMemo(
    () =>
      customers
        .filter((c) => c.revenue > 0)
        .map((c) => ({ name: c.customer, size: c.revenue, margin: c.totalMarginPct })),
    [customers]
  )

  if (data.length === 0) return null

  return (
    <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Revenue Concentration
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(16,185,129,0.8)' }} />
            High margin
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(239,68,68,0.75)' }} />
            Negative
          </span>
        </div>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="size"
            aspectRatio={4 / 3}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content={(props: any) => <TreemapCell {...props} />}
          />
        </ResponsiveContainer>
      </div>
    </div>
  )
}
