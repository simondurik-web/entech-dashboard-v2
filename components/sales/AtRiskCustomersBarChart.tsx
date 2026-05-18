'use client'

import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { useI18n } from '@/lib/i18n'
import {
  RISK_TIER_HEX,
  RISK_TIER_PRIORITY,
  fmtRevenueShort as fmtRevenue,
  getRiskTierLabel,
  type RiskTier,
  type CustomerRiskMetrics,
} from '@/lib/at-risk'

interface AtRiskCustomerForChart {
  customer: string
  daysSinceLastOrder: number | null
  revenue12mo: number
  riskTier: RiskTier
}

interface Props {
  customers: AtRiskCustomerForChart[]
  /** When user clicks a bar, scroll-to + auto-expand that customer's row. */
  onSelect?: (customer: string) => void
  /** Limit how many customers to render. Default 15 (so chart fits). */
  limit?: number
}

function ChartTooltip({
  active, payload, language,
}: {
  active?: boolean
  payload?: Array<{ payload: AtRiskCustomerForChart & { score: number } }>
  language: 'en' | 'es'
}) {
  if (!active || !payload?.[0]) return null
  const r = payload[0].payload
  return (
    <div
      style={{
        backgroundColor: 'hsl(var(--popover))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '8px',
        fontSize: '12px',
        padding: '8px 12px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        minWidth: '180px',
      }}
      className="space-y-1"
    >
      <p className="font-semibold text-foreground">{r.customer}</p>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{language === 'es' ? 'Nivel' : 'Tier'}</span>
        <span className="font-semibold" style={{ color: RISK_TIER_HEX[r.riskTier] }}>
          {getRiskTierLabel(r.riskTier, language)}
        </span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{language === 'es' ? 'Días sin pedido' : 'Days Since'}</span>
        <span className="font-semibold">{r.daysSinceLastOrder ?? '—'}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{language === 'es' ? 'Ingresos 12m' : '12mo Revenue'}</span>
        <span className="font-semibold">{fmtRevenue(r.revenue12mo)}</span>
      </div>
      <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/40">
        {language === 'es' ? 'haz clic para ver detalle' : 'click to view detail'}
      </p>
    </div>
  )
}

export function AtRiskCustomersBarChart({ customers, onSelect, limit = 15 }: Props) {
  const { language } = useI18n()
  const ranked = useMemo(() => {
    return customers
      .filter((c) => {
        const tierPriority = RISK_TIER_PRIORITY[c.riskTier]
        return tierPriority <= RISK_TIER_PRIORITY.new && c.daysSinceLastOrder != null && c.riskTier !== 'active'
      })
      .map((c) => {
        // Composite urgency: longer gap × log(revenue) so high-stake at-risk
        // customers float up. NaN-guard for negative or non-finite revenue.
        const rev = Number.isFinite(c.revenue12mo) ? Math.max(0, c.revenue12mo) : 0
        const score = (c.daysSinceLastOrder ?? 0) * Math.log10(rev + 10)
        return { ...c, score }
      })
      .sort((a, b) => {
        const tierDiff = RISK_TIER_PRIORITY[a.riskTier] - RISK_TIER_PRIORITY[b.riskTier]
        if (tierDiff !== 0) return tierDiff
        return b.score - a.score
      })
      .slice(0, limit)
  }, [customers, limit])

  if (ranked.length === 0) {
    return (
      <div className="rounded-xl border bg-card backdrop-blur-xl p-5 shadow-lg">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {language === 'es' ? 'Clientes en Riesgo (Vista de Barras)' : 'At-Risk Customers (Bar View)'}
        </h3>
        <p className="text-xs text-muted-foreground py-8 text-center">
          {language === 'es'
            ? 'Ningún cliente marcado — cada cuenta activa está en ritmo 🎯'
            : 'No customers flagged — every active account is on cadence 🎯'}
        </p>
      </div>
    )
  }

  const chartHeight = Math.max(ranked.length * 32 + 60, 200)

  return (
    <div className="rounded-xl border bg-card backdrop-blur-xl p-5 shadow-lg">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            {language === 'es' ? 'Clientes en Riesgo — Vista de Barras' : 'At-Risk Customers — Bar View'}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {language === 'es'
              ? 'Ordenado por nivel de prioridad y luego por brecha × ingresos. Haz clic en una barra para detalle.'
              : 'Sorted by tier priority then by gap × revenue (high-stake at-risk float up). Click a bar to drill in.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {(['at_risk', 'dormant', 'watch', 'churned', 'new'] as RiskTier[]).map((tier) => (
            <span key={tier} className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: RISK_TIER_HEX[tier] }} />
              <span className="text-muted-foreground">{getRiskTierLabel(tier, language)}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ranked} layout="vertical" margin={{ top: 5, right: 80, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}d`}
            />
            <YAxis
              type="category"
              dataKey="customer"
              width={150}
              tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip language={language} />} cursor={{ fill: 'hsl(var(--accent))' }} />
            <Bar
              dataKey="daysSinceLastOrder"
              radius={[0, 6, 6, 0]}
              onClick={(data: unknown) => {
                const d = data as { payload?: { customer?: string }; customer?: string } | undefined
                const name = d?.payload?.customer ?? d?.customer
                if (name) onSelect?.(name)
              }}
              cursor={onSelect ? 'pointer' : 'default'}
              label={{
                position: 'right',
                fill: 'hsl(var(--foreground))',
                fontSize: 11,
                // Recharts 3 only passes `value` to label formatter (not the
                // full row payload). Tooltip has the revenue + tier detail.
                formatter: (value: unknown) => {
                  const v = typeof value === 'number' ? value : 0
                  return `${v}d`
                },
              }}
            >
              {ranked.map((r) => (
                <Cell key={r.customer} fill={RISK_TIER_HEX[r.riskTier]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Re-export for the page so it can pass in CustomerRow shape directly
export type { AtRiskCustomerForChart, CustomerRiskMetrics }
