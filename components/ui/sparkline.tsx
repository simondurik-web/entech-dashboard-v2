'use client'

import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

interface SparklineProps {
  data: number[]
  color?: string
  className?: string
}

export function Sparkline({ data, color, className }: SparklineProps) {
  const chartData = data.map((v, i) => ({ v, i }))
  const isPositive = data.length >= 2 && data[data.length - 1] >= data[0]
  const lineColor = color || (isPositive ? '#38a169' : '#e53e3e')

  return (
    <div className={cn('h-10 w-20', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={lineColor}
            fill={lineColor}
            fillOpacity={0.1}
            strokeWidth={1.5}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
