'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem } from '@/lib/google-sheets-shared'

function stockStatus(item: InventoryItem): 'ok' | 'low' | 'critical' {
  if (item.minimum <= 0) return 'ok'
  const pct = item.inStock / item.minimum
  if (pct < 0.5) return 'critical'
  if (pct < 1) return 'low'
  return 'ok'
}

const STATUS_STYLES = {
  critical: { border: 'border-l-red-500', badge: 'bg-red-500/20 text-red-600', label: 'CRITICAL', bar: 'bg-red-500', text: 'text-red-500' },
  low: { border: 'border-l-yellow-500', badge: 'bg-yellow-500/20 text-yellow-600', label: 'LOW', bar: 'bg-yellow-500', text: 'text-yellow-500' },
  ok: { border: 'border-l-green-500', badge: 'bg-green-500/20 text-green-600', label: 'OK', bar: 'bg-green-500', text: 'text-green-500' },
} as const

const TYPE_BADGES: Record<string, { emoji: string; style: string }> = {
  Manufactured: { emoji: '🏭', style: 'bg-blue-500/15 text-blue-600' },
  Purchased: { emoji: '🛒', style: 'bg-orange-500/15 text-orange-600' },
  COM: { emoji: '📦', style: 'bg-purple-500/15 text-purple-600' },
}

function trendIndicator(usage7: number | null, usage30: number | null, isManufactured: boolean) {
  if (usage7 == null || usage30 == null) return null
  if (usage7 > usage30 * 1.1) return isManufactured
    ? { text: '↑ Faster', color: 'text-green-500' }
    : { text: '↑ Up', color: 'text-red-500' }
  if (usage7 < usage30 * 0.9) return isManufactured
    ? { text: '↓ Slower', color: 'text-red-500' }
    : { text: '↓ Down', color: 'text-green-500' }
  return { text: '→ Stable', color: 'text-muted-foreground' }
}

function daysColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground'
  if (days === 0) return 'text-red-500 font-bold'
  if (days < 7) return 'text-red-500'
  if (days < 30) return 'text-yellow-500'
  return 'text-green-500'
}

interface InventoryCardProps {
  item: InventoryItem
  index: number
}

export function InventoryCard({ item, index }: InventoryCardProps) {
  const status = stockStatus(item)
  const style = STATUS_STYLES[status]
  const pct = item.minimum > 0 ? Math.round((item.inStock / item.minimum) * 100) : 100
  const typeBadge = item.itemType ? TYPE_BADGES[item.itemType] : null
  const trend = trendIndicator(item.usage7, item.usage30, item.isManufactured)

  return (
    <Card key={`${item.partNumber}-${index}`} className={`border-l-4 ${style.border}`}>
      <CardHeader className="pb-1 pt-3 px-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base leading-tight truncate">{item.partNumber}</CardTitle>
              {typeBadge && (
                <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium shrink-0 ${typeBadge.style}`}>
                  {typeBadge.emoji} {item.itemType}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.product}</p>
          </div>
          <span className={`px-1.5 py-0.5 text-[10px] rounded font-semibold shrink-0 ${style.badge}`}>
            {style.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
          <div>
            <span className="text-muted-foreground">In Stock</span>
            <p className={`font-semibold ${style.text}`}>{item.inStock.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Minimum</span>
            <p className="font-semibold">{item.minimum.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Target</span>
            <p className="font-semibold">{item.target > 0 ? item.target.toLocaleString() : '-'}</p>
          </div>
        </div>

        {/* Forecast row */}
        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
          <div>
            <span className="text-muted-foreground">{item.isManufactured ? 'Prod Rate' : 'Daily Usage'}</span>
            <p className="font-semibold">
              {item.projectionRate ? `${item.projectionRate.toFixed(1)}/d` : '-'}
              {item.isManufactured && item.projectionRate ? ' ⚙️' : ''}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Trend</span>
            <p className={`font-semibold ${trend?.color || 'text-muted-foreground'}`}>
              {trend?.text || '-'}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">
              {item.isManufactured ? 'Days to Target' : 'Days to Min'}
            </span>
            <p className={`font-semibold ${daysColor(item.daysToMin)}`}>
              {item.daysToMin !== null ? (item.daysToMin === 0 ? '⚠️ NOW' : `${item.daysToMin}d`) : '-'}
            </p>
          </div>
        </div>

        {/* Days to Zero (non-manufactured only) */}
        {!item.isManufactured && item.daysToZero !== null && (
          <div className="text-xs mb-2">
            <span className="text-muted-foreground">Days to Zero: </span>
            <span className={`font-semibold ${daysColor(item.daysToZero)}`}>{item.daysToZero}d</span>
          </div>
        )}

        {item.minimum > 0 && (
          <div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${style.bar} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">{pct}% of minimum</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
