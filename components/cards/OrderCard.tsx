'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OrderDetail } from '@/components/OrderDetail'
import type { Order } from '@/lib/google-sheets'
import { normalizeStatus } from '@/lib/google-sheets'
import { getEffectivePriority } from '@/lib/priority'

/** Category-based color coding */
function categoryStyle(category: string) {
  const cat = category.toLowerCase()
  if (cat.includes('roll')) return { border: 'border-l-blue-500', bg: 'bg-blue-500/5', badge: 'bg-blue-500/20 text-blue-600', label: 'Roll Tech' }
  if (cat.includes('molding')) return { border: 'border-l-yellow-500', bg: 'bg-yellow-500/5', badge: 'bg-yellow-500/20 text-yellow-600', label: 'Molding' }
  if (cat.includes('snap')) return { border: 'border-l-purple-500', bg: 'bg-purple-500/5', badge: 'bg-purple-500/20 text-purple-600', label: 'Snap Pad' }
  return { border: 'border-l-gray-400', bg: '', badge: 'bg-muted text-muted-foreground', label: category || 'Other' }
}

function priorityBadge(order: Order) {
  const effective = getEffectivePriority(order)
  const isOverridden = !!order.priorityOverride

  if (!effective) return <span className="text-muted-foreground text-xs">-</span>

  if (effective === 'URGENT') {
    return (
      <span className="inline-flex items-center gap-0.5">
        <span className="px-1.5 py-0.5 text-[10px] rounded font-bold bg-red-500 text-white">URGENT</span>
        {isOverridden && <span className="text-[8px] text-amber-500">📌</span>}
      </span>
    )
  }

  const colors: Record<string, string> = {
    P1: 'bg-red-500/20 text-red-600',
    P2: 'bg-orange-500/20 text-orange-600',
    P3: 'bg-yellow-500/20 text-yellow-600',
    P4: 'bg-blue-500/20 text-blue-600',
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className={`px-1.5 py-0.5 text-[10px] rounded font-semibold ${colors[effective] || 'bg-muted text-muted-foreground'}`}>{effective}</span>
      {isOverridden && <span className="text-[8px] text-amber-500">📌</span>}
    </span>
  )
}

function statusBadge(status: string) {
  const s = status.toLowerCase()
  let color = 'bg-muted text-muted-foreground'
  if (s === 'shipped' || s === 'invoiced' || s === 'to bill') color = 'bg-blue-500/20 text-blue-600'
  else if (s === 'staged' || s === 'ready to ship') color = 'bg-green-500/20 text-green-600'
  else if (s === 'wip' || s === 'work in progress' || s === 'making' || s === 'released' || s === 'in production') color = 'bg-teal-500/20 text-teal-600'
  else if (s === 'pending' || s === 'need to make' || s === 'approved') color = 'bg-yellow-500/20 text-yellow-600'
  else if (s === 'cancelled') color = 'bg-red-500/20 text-red-600'
  return <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${color}`}>{status || 'N/A'}</span>
}

function dueDisplay(days: number | null) {
  if (days === null) return <span className="text-muted-foreground">-</span>
  if (days < 0) return <span className="text-red-500 font-bold">{days}d</span>
  if (days <= 3) return <span className="text-orange-500 font-semibold">{days}d</span>
  return <span>{days}d</span>
}

interface OrderCardProps {
  order: Order
  index: number
  isExpanded: boolean
  onToggle: () => void
  /** Override status label (e.g. "STAGED", "Shipped") */
  statusOverride?: string
  /** Show ship date instead of days until due */
  showShipDate?: boolean
  /** Extra fields to show in grid */
  extraFields?: React.ReactNode
}

export function OrderCard({ order, index, isExpanded, onToggle, statusOverride, showShipDate, extraFields }: OrderCardProps) {
  const style = categoryStyle(order.category)

  return (
    <Card
      key={`${order.ifNumber}-${index}`}
      className={`border-l-4 cursor-pointer transition-colors ${style.border} ${style.bg} ${isExpanded ? 'ring-1 ring-primary/20' : ''}`}
      onClick={onToggle}
    >
      <CardHeader className="pb-1 pt-3 px-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-tight truncate">{order.customer}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {order.partNumber} <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${style.badge}`}>{style.label}</span>
            </p>
          </div>
          {statusOverride ? (
            statusBadge(statusOverride)
          ) : (
            statusBadge(order.internalStatus)
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
          <div>
            <span className="text-muted-foreground">Qty</span>
            <p className="font-semibold">{order.orderQty.toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Priority</span>
            <p>{priorityBadge(order)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{showShipDate ? 'Shipped' : 'Due'}</span>
            <p className="font-semibold">
              {showShipDate ? (order.shippedDate || '-') : dueDisplay(order.daysUntilDue)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">IF#</span>
            <p className="font-semibold truncate">{order.ifNumber || '-'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">PO#</span>
            <p className="font-semibold truncate">{order.poNumber || '-'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Line</span>
            <p className="font-semibold">{order.line || '-'}</p>
          </div>
          {extraFields}
        </div>
        {/* Expandable OrderDetail */}
        <div
          className={`grid transition-all duration-300 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {isExpanded && (
              <OrderDetail
                ifNumber={order.ifNumber}
                line={order.line}
                isShipped={normalizeStatus(order.internalStatus, order.ifStatus) === 'shipped' || !!order.shippedDate}
                shippedDate={order.shippedDate}
                partNumber={order.partNumber}
                tirePartNum={order.tire}
                hubPartNum={order.hub}
                onClose={onToggle}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
