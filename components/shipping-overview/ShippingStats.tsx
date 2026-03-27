import type { ShippingOverviewSummaryStats } from '@/components/shipping-overview/types'

interface ShippingStatsProps {
  stats: ShippingOverviewSummaryStats
  days?: number
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function ShippingStats({ stats, days = 10 }: ShippingStatsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* Staged column stats */}
      <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white backdrop-blur-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Ready to Ship</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-white/60">Orders</div>
            <div className="text-xl font-extrabold">{stats.stagedOrders.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Revenue</div>
            <div className="text-xl font-extrabold">{formatCurrency(stats.stagedRevenue)}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Units</div>
            <div className="text-xl font-extrabold">{stats.stagedUnits.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Shipped column stats */}
      <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white backdrop-blur-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Shipped (Last {days}d)</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-white/60">Orders</div>
            <div className="text-xl font-extrabold">{stats.shippedOrders.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Revenue</div>
            <div className="text-xl font-extrabold">{formatCurrency(stats.shippedRevenue)}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Units</div>
            <div className="text-xl font-extrabold">{stats.shippedUnits.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
