'use client'

import { useMemo } from 'react'
import { ChevronDown, FileText, Package2, Truck } from 'lucide-react'
import { PalletTable } from '@/components/shipping-overview/PalletTable'
import { PhotoGallery } from '@/components/shipping-overview/PhotoGallery'
import type { ShippingOverviewOrder } from '@/components/shipping-overview/types'
import { cn } from '@/lib/utils'

interface ShippingOverviewCardProps {
  order: ShippingOverviewOrder
  expanded: boolean
  onToggle: () => void
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const parts = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (parts) {
    const [, month, day, year] = parts
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function getDueState(order: ShippingOverviewOrder): { label: string; tone: string } {
  const today = startOfDay(new Date())

  if (order.status === 'shipped') {
    const shippedDate = parseDate(order.shippedDate)
    const dueDate = parseDate(order.requestedDate)
    if (!shippedDate || !dueDate) return { label: 'Date unavailable', tone: 'text-muted-foreground' }

    const diffDays = Math.round((startOfDay(shippedDate).getTime() - startOfDay(dueDate).getTime()) / 86400000)
    if (diffDays > 0) return { label: `${diffDays} day${diffDays === 1 ? '' : 's'} LATE`, tone: 'text-red-600 dark:text-red-400' }
    if (diffDays < 0) return { label: `${Math.abs(diffDays)} day${diffDays === -1 ? '' : 's'} early`, tone: 'text-muted-foreground' }
    return { label: 'On time', tone: 'text-muted-foreground' }
  }

  const dueDate = parseDate(order.requestedDate)
  if (!dueDate) return { label: 'Date unavailable', tone: 'text-muted-foreground' }
  const diffDays = Math.round((startOfDay(dueDate).getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return { label: 'OVERDUE', tone: 'text-red-600 dark:text-red-400' }
  if (diffDays === 0) return { label: 'Due TODAY', tone: 'text-amber-600 dark:text-amber-400' }
  return { label: `${diffDays} day${diffDays === 1 ? '' : 's'} left`, tone: 'text-muted-foreground' }
}

export function ShippingOverviewCard({ order, expanded, onToggle }: ShippingOverviewCardProps) {
  const statusLabel = getDueState(order)
  const badgeLabel = useMemo(() => {
    const segments: string[] = []
    if (order.palletCount > 0) segments.push(`${order.palletCount} pallet${order.palletCount === 1 ? '' : 's'}`)
    const photoCount = order.palletPhotoCount + order.shippingPhotoCount
    if (photoCount > 0) segments.push(`${photoCount} photo${photoCount === 1 ? '' : 's'}`)
    return segments.join(' · ')
  }, [order.palletCount, order.palletPhotoCount, order.shippingPhotoCount])

  return (
    <article className="overflow-hidden rounded-2xl border border-[#e1e8ed] bg-card shadow-sm transition hover:shadow-md dark:border-slate-800">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full flex-col gap-4 px-5 py-4 text-left transition sm:flex-row sm:items-center sm:justify-between',
          expanded ? 'bg-slate-100 dark:bg-slate-900' : 'bg-[#fafbfc] hover:bg-[#f0f3f5] dark:bg-slate-950 dark:hover:bg-slate-900'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold text-[#2a5298] dark:text-blue-300">{order.customer}</h3>
            {badgeLabel && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                {badgeLabel}
              </span>
            )}
            {order.shipping?.carrier && (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                {order.shipping.carrier}
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {order.partNumber} • IF#: {order.ifNumber || '-'} • Line: {order.line || '-'} • PO: {order.poNumber || '-'}
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-8">
          <div className="grid grid-cols-2 gap-4 sm:flex sm:items-center sm:gap-8">
            <div className="text-right">
              <div className="text-[15px] font-bold text-foreground">{formatCurrency(order.revenue)}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Revenue</div>
            </div>
            <div className="text-right">
              <div className="text-[15px] font-bold text-foreground">{formatNumber(order.orderQty)}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Units</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-foreground">{order.status === 'shipped' ? order.shippedDate || '-' : order.requestedDate || '-'}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{order.status === 'shipped' ? 'Shipped Date' : 'Due Date'}</div>
            </div>
            <div className="text-right">
              <div className={cn('text-xs font-semibold', statusLabel.tone)}>{statusLabel.label}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{order.status === 'shipped' ? 'Ship Status' : 'Days Remaining'}</div>
            </div>
          </div>
          <ChevronDown className={cn('size-5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-[#e1e8ed] bg-card px-5 py-5 dark:border-slate-800">
          {(order.shipping || order.shipToAddress || order.shippingNotes || order.internalNotes || order.shippingCost > 0) && (
            <section className="rounded-xl border border-[#e1e8ed] bg-muted/30 p-4 dark:border-slate-800">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <Truck className="size-4" />
                <span>Shipping Information</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <InfoBlock label="Pickup Date" value={order.shipping?.shipDate || 'Not set'} />
                <InfoBlock label="Shipping Cost" value={formatCurrency(order.shippingCost)} tone="success" />
                <InfoBlock label="Ship-to Address" value={order.shipToAddress || 'Not set'} fullWidth boxed />
                <InfoBlock label="Shipping Notes" value={order.shippingNotes || 'Not set'} fullWidth boxed variant="warning" />
                <InfoBlock label="Internal Notes" value={order.internalNotes || 'Not set'} fullWidth boxed variant="danger" />
              </div>
            </section>
          )}

          {order.palletCount > 0 && (
            <section className="rounded-xl border-l-4 border-l-[#2a5298] bg-muted/30 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <Package2 className="size-4" />
                <span>Pallet Summary</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryRow label="Pallets" value={String(order.palletCount)} />
                <SummaryRow label="Total Weight" value={`${formatNumber(order.totalPalletWeight)} lbs`} />
                <SummaryRow label="Dimensions" value={order.dimensionsSummary || '-'} />
              </div>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center gap-2 border-b border-[#e1e8ed] pb-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground dark:border-slate-800">
              <Package2 className="size-4" />
              <span>Pallet Details</span>
            </div>
            <PalletTable pallets={order.pallets} ifNumber={order.ifNumber} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 border-b border-[#e1e8ed] pb-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground dark:border-slate-800">
              <FileText className="size-4" />
              <span>Shipping Photos</span>
              {order.shipping?.carrier && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] tracking-normal text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  {order.shipping.carrier}
                </span>
              )}
            </div>
            <div className="rounded-xl border-l-4 border-l-amber-400 bg-muted/20 p-4">
              <PhotoGallery
                ifNumber={order.ifNumber}
                groups={[
                  { key: 'shipment', title: 'Shipment Pictures', photos: order.shipping?.shipmentPhotos ?? [] },
                  { key: 'paperwork', title: 'Paperwork Pictures', photos: order.shipping?.paperworkPhotos ?? [] },
                  { key: 'closeup', title: 'Close-up Pictures', photos: order.shipping?.closeUpPhotos ?? [] },
                ]}
              />
            </div>
          </section>
        </div>
      )}
    </article>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="text-sm font-bold text-foreground">{value}</span>
    </div>
  )
}

function InfoBlock({
  label,
  value,
  fullWidth = false,
  boxed = false,
  tone,
  variant = 'default',
}: {
  label: string
  value: string
  fullWidth?: boolean
  boxed?: boolean
  tone?: 'success'
  variant?: 'default' | 'warning' | 'danger'
}) {
  return (
    <div className={cn('flex flex-col gap-1', fullWidth && 'md:col-span-2')}>
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-sm text-foreground',
          !value || value === 'Not set' ? 'italic text-muted-foreground' : '',
          tone === 'success' && 'font-bold text-emerald-600 dark:text-emerald-400',
          boxed && 'rounded-md border px-3 py-2 whitespace-pre-line',
          boxed && variant === 'default' && 'bg-background',
          boxed && variant === 'warning' && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
          boxed && variant === 'danger' && 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
        )}
      >
        {value || 'Not set'}
      </div>
    </div>
  )
}
