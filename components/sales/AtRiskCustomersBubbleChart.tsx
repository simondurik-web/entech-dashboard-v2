'use client'

import { useMemo } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import { useI18n } from '@/lib/i18n'
import {
  RISK_TIER_HEX,
  fmtRevenueShort as fmtRevenue,
  getRiskTierLabel,
  type RiskTier,
} from '@/lib/at-risk'

interface AtRiskCustomerForChart {
  customer: string
  daysSinceLastOrder: number | null
  revenue12mo: number
  riskTier: RiskTier
  shippedOrderCount: number
}

interface Props {
  customers: AtRiskCustomerForChart[]
  onSelect?: (customer: string) => void
}

function BubbleTooltip({
  active, payload, language,
}: {
  active?: boolean
  payload?: Array<{ payload: AtRiskCustomerForChart }>
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
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{language === 'es' ? 'Pedidos (total)' : 'Orders (lifetime)'}</span>
        <span className="font-semibold">{r.shippedOrderCount}</span>
      </div>
      <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/40">
        {language === 'es' ? 'haz clic para ver detalle' : 'click to view detail'}
      </p>
    </div>
  )
}

export function AtRiskCustomersBubbleChart({ customers, onSelect }: Props) {
  const { language } = useI18n()

  // Drop only nulls + already-active. Keep dormant/churned customers with $0
  // 12-mo revenue — they're exactly the ones the salesman needs to call.
  // Their bubbles land at y=0 along the bottom of the chart.
  const data = useMemo(() => {
    return customers
      .filter((c): c is AtRiskCustomerForChart & { daysSinceLastOrder: number } =>
        c.daysSinceLastOrder != null && c.riskTier !== 'active',
      )
      .map((c) => ({ ...c, revenue12mo: Number.isFinite(c.revenue12mo) ? Math.max(0, c.revenue12mo) : 0 }))
  }, [customers])

  if (data.length === 0) {
    return (
      <div className="rounded-xl border bg-card backdrop-blur-xl p-5 shadow-lg">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {language === 'es' ? 'Clientes en Riesgo (Vista de Burbujas)' : 'At-Risk Customers (Bubble View)'}
        </h3>
        <p className="text-xs text-muted-foreground py-8 text-center">
          {language === 'es'
            ? 'Ningún cliente con datos de brecha — prueba la Vista de Barras 🎯'
            : 'No customers with gap data — try the Bar view above 🎯'}
        </p>
      </div>
    )
  }

  // Median lines to split into quadrants — high-revenue / long-gap = top-right danger zone.
  // Skip reference lines when too few bubbles (median through 1 bubble is noise).
  const showMedianLines = data.length >= 4
  const sortedDays = showMedianLines ? [...data].map((d) => d.daysSinceLastOrder).sort((a, b) => a - b) : []
  const sortedRev = showMedianLines ? [...data].map((d) => d.revenue12mo).sort((a, b) => a - b) : []
  const midDays = showMedianLines ? sortedDays[Math.floor(sortedDays.length / 2)] : null
  const midRev = showMedianLines ? sortedRev[Math.floor(sortedRev.length / 2)] : null

  return (
    <div className="rounded-xl border bg-card backdrop-blur-xl p-5 shadow-lg">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            {language === 'es' ? 'Clientes en Riesgo — Vista de Burbujas' : 'At-Risk Customers — Bubble View'}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {language === 'es'
              ? 'X = días sin pedido · Y = ingresos 12m · tamaño = pedidos totales. Esquina superior derecha = alto valor + brecha larga.'
              : 'X = days since last order · Y = 12mo revenue · bubble size = lifetime orders. Top-right = high-value + long gap.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {(['at_risk', 'dormant', 'watch', 'churned', 'new'] as RiskTier[]).map((tier) => (
            <span key={tier} className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: RISK_TIER_HEX[tier] }} />
              <span className="text-muted-foreground">{getRiskTierLabel(tier, language)}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 32, bottom: 32, left: 32 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
            <XAxis
              type="number"
              dataKey="daysSinceLastOrder"
              name="Days since"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              label={{ value: 'Days since last order', position: 'insideBottom', offset: -12, fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="revenue12mo"
              name="12mo Revenue"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              tickFormatter={(v) => fmtRevenue(v as number)}
              label={{ value: '12mo revenue', angle: -90, position: 'insideLeft', offset: 10, fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="shippedOrderCount" range={[60, 600]} />
            {showMedianLines && midDays != null && (
              <ReferenceLine x={midDays} stroke="hsl(var(--border))" strokeDasharray="4 4" />
            )}
            {showMedianLines && midRev != null && (
              <ReferenceLine y={midRev} stroke="hsl(var(--border))" strokeDasharray="4 4" />
            )}
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<BubbleTooltip language={language} />} />
            <Scatter
              name="Customers"
              data={data}
              onClick={(d: unknown) => {
                const x = d as { payload?: { customer?: string }; customer?: string } | undefined
                const name = x?.payload?.customer ?? x?.customer
                if (name) onSelect?.(name)
              }}
              cursor={onSelect ? 'pointer' : 'default'}
            >
              {data.map((c) => (
                <Cell key={c.customer} fill={RISK_TIER_HEX[c.riskTier]} fillOpacity={0.7} stroke={RISK_TIER_HEX[c.riskTier]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export type { AtRiskCustomerForChart }
