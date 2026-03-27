'use client'

import { type ReactNode } from 'react'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Sparkline } from '@/components/ui/sparkline'

interface Props {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  color?: string
  trendData?: number[]
}

export function EnhancedStatCard({ icon, label, value, sub, color, trendData }: Props) {
  return (
    <div
      className="rounded-xl border border-white/[0.06] backdrop-blur-xl p-4 flex items-start gap-3 shadow-lg transition-all duration-200 hover:shadow-xl hover:border-white/[0.1] relative overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at top left, rgba(255,255,255,0.035) 0%, transparent 55%), rgba(255,255,255,0.01)',
      }}
    >
      {trendData && trendData.length >= 2 && (
        <div className="absolute bottom-0 right-0 w-full h-12 opacity-[0.07] pointer-events-none">
          <Sparkline data={trendData} className="w-full h-full" />
        </div>
      )}
      <div className={`rounded-lg p-2.5 z-10 flex-shrink-0 ${color || 'bg-primary/10 text-primary'}`}>
        {icon}
      </div>
      <div className="min-w-0 z-10">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold mt-0.5">
          <AnimatedNumber value={value} duration={2500} />
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
