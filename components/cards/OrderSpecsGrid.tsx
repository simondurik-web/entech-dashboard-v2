'use client'

import type { Order } from '@/lib/google-sheets-shared'
import { allocationKey, type ComponentAvailabilityMap, type OrderAllocationMap } from '@/lib/component-availability'
import { InventoryPopover } from '@/components/InventoryPopover'
import { useI18n } from '@/lib/i18n'

// Desktop-parity spec grid for the phone order cards (Simon 2026-07-08: the
// card view hid most of the table's information — tapping a card should show
// the same fields and the same availability color coding the desktop has).
// Rendered inside OrderCard's expanded area, above OrderDetail.

export interface OrderStockInfo {
  onHand: number
  committed: number
  available: number
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <p className="font-semibold truncate">{children}</p>
    </div>
  )
}

export function OrderSpecsGrid({ order, compAvail, alloc, stock }: {
  order: Order
  compAvail: ComponentAvailabilityMap
  /** Per-order allocation verdicts — when provided, cell colors reflect this
   *  order's place in the fulfillment queue instead of the aggregate rule. */
  alloc?: OrderAllocationMap
  stock?: OrderStockInfo | null
}) {
  const { t } = useI18n()
  const isRollTech = order.category.toLowerCase().includes('roll')
  const verdicts = alloc?.get(allocationKey(order))

  const component = (value: string, type: 'tire' | 'hub') => {
    const v = (value || '').trim()
    if (!isRollTech || !v || v === '-') return <span className="text-muted-foreground">-</span>
    const avail = compAvail.get(v.toUpperCase())
    const ok = (type === 'tire' ? verdicts?.tireOk : verdicts?.hubOk) ?? avail?.ok
    return (
      <span className="inline-flex items-center gap-1">
        <span className={ok ? 'text-green-500' : 'text-red-400'}>{v}</span>
        <InventoryPopover partNumber={v} partType={type} needed={avail?.demand} />
      </span>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs rounded-lg bg-muted/40 p-2.5 mb-2">
      <Field label={t('table.tire')}>{component(order.tire, 'tire')}</Field>
      <Field label={t('table.hub')}>{component(order.hub, 'hub')}</Field>
      <Field label={t('table.hubMold')}>{order.hubMold || '-'}</Field>
      <Field label={t('table.bearings')}>{order.bearings || '-'}</Field>
      <Field label={t('table.packages')}>{order.numPackages > 0 ? Math.ceil(order.numPackages).toLocaleString() : '-'}</Field>
      <Field label={t('table.partPerPackage')}>{order.partsPerPackage > 0 ? order.partsPerPackage.toLocaleString() : '-'}</Field>
      <Field label={t('table.packaging')}>{order.packaging || '-'}</Field>
      {stock && (
        <>
          <Field label={t('table.onHand')}>{stock.onHand.toLocaleString()}</Field>
          <Field label={t('table.committed')}>
            {stock.committed > 0
              ? <span className="text-amber-400">{stock.committed.toLocaleString()}</span>
              : '—'}
          </Field>
          <Field label={t('table.fusionInv')}>
            <span className={(verdicts?.stockOk ?? (stock.available >= order.orderQty)) ? 'text-green-500' : 'text-red-400'}>
              {stock.available.toLocaleString()}
            </span>
          </Field>
        </>
      )}
      <Field label={t('table.assignedTo')}>{order.assignedTo || '-'}</Field>
      <Field label={t('table.dueDate')}>{order.requestedDate || '-'}</Field>
    </div>
  )
}

export default OrderSpecsGrid
