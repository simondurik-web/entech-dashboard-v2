import type { ShippingOverviewSummaryStats } from '@/components/shipping-overview/types'

interface ShippingStatsProps {
  stats: ShippingOverviewSummaryStats
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function ShippingStats({ stats }: ShippingStatsProps) {
  const items = [
    { label: 'Staged Orders', value: stats.stagedOrders.toLocaleString() },
    { label: 'Shipped (10 Days)', value: stats.shippedOrders.toLocaleString() },
    { label: 'Total Revenue', value: formatCurrency(stats.totalRevenue) },
    { label: 'Total Units', value: stats.totalUnits.toLocaleString() },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-white/20 bg-white/10 px-4 py-4 text-white backdrop-blur-sm"
        >
          <div className="text-xs uppercase tracking-[0.18em] text-white/70">{item.label}</div>
          <div className="mt-2 text-2xl font-extrabold">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
