'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryItem } from '@/lib/google-sheets'

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

interface InventoryCardProps {
  item: InventoryItem
  index: number
}

export function InventoryCard({ item, index }: InventoryCardProps) {
  const status = stockStatus(item)
  const style = STATUS_STYLES[status]
  const pct = item.minimum > 0 ? Math.round((item.inStock / item.minimum) * 100) : 100

  return (
    <Card key={`${item.partNumber}-${index}`} className={`border-l-4 ${style.border}`}>
      <CardHeader className="pb-1 pt-3 px-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-tight truncate">{item.partNumber}</CardTitle>
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
