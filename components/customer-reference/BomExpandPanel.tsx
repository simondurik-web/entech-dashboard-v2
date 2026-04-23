'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Package, Layers, FileText, AlertCircle, ExternalLink } from 'lucide-react'
import { InventoryPopover } from '@/components/InventoryPopover'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { DrawingIconButton } from './DrawingIconButton'
import type { DrawingProductType, FinalAssemblyLite, SubAssemblyLite, IndividualItemLite, DrawingLite } from '@/lib/customer-reference-bom'

interface BomExpandPanelProps {
  partNumber: string
  loading: boolean
  errored: boolean
  onRetry: () => void
  finalAssembly: FinalAssemblyLite | null
  subAssembly: SubAssemblyLite | null
  individualItem: IndividualItemLite | null
  drawings: Map<string, DrawingLite>
  /** DOM id for the expanded panel — paired with `aria-controls` on the chevron trigger. */
  id?: string
}

const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return `$${v.toFixed(v < 1 ? 4 : 2)}`
}

const fmtQty = (q: number | null | undefined) => {
  if (q === null || q === undefined) return '—'
  const v = Number(q)
  if (!Number.isFinite(v)) return '—'
  return v.toFixed(6).replace(/\.?0+$/, '')
}

function inventoryChipKindFromDrawing(productType: DrawingProductType | undefined): 'tire' | 'hub' | 'part' {
  switch (productType) {
    case 'Tire': return 'tire'
    case 'Hub': return 'hub'
    default: return 'part'
  }
}

function CostLine({ label, value, muted = false, emphasis = false }: { label: string; value: string; muted?: boolean; emphasis?: boolean }) {
  return (
    <div className={`flex justify-between ${emphasis ? 'font-semibold' : ''} ${muted ? 'text-muted-foreground' : ''}`}>
      <span className={muted ? '' : 'text-muted-foreground'}>{label}:</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}

function KindBadge({ kind }: { kind: 'final' | 'sub' | 'individual' }) {
  const { t } = useI18n()
  const palette: Record<typeof kind, string> = {
    final: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    sub: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    individual: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  }
  const label =
    kind === 'final' ? t('customerRef.finalAssemblyKind') :
    kind === 'sub' ? t('customerRef.subAssemblyKind') :
    t('customerRef.individualKind')
  const Icon = kind === 'final' ? Layers : kind === 'sub' ? Package : FileText
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${palette[kind]}`}>
      <Icon className="size-3" />
      {label}
    </span>
  )
}

export function BomExpandPanel(props: BomExpandPanelProps) {
  const { t } = useI18n()
  const { partNumber, loading, errored, onRetry, finalAssembly, subAssembly, individualItem, drawings, id } = props

  const kind: 'final' | 'sub' | 'individual' | null =
    finalAssembly ? 'final' : subAssembly ? 'sub' : individualItem ? 'individual' : null

  // Surface a data-hygiene warning when the same PN resolves in multiple BOM tiers.
  const multiTier: Array<'final' | 'sub' | 'individual'> = []
  if (finalAssembly) multiTier.push('final')
  if (subAssembly) multiTier.push('sub')
  if (individualItem) multiTier.push('individual')

  // Build a unified component list from whichever tier matched.
  const components = useMemo(() => {
    if (finalAssembly) {
      return (finalAssembly.components ?? []).map((c) => ({
        partNumber: c.component_part_number,
        source: c.component_source === 'sub_assembly' ? 'sub' as const : 'individual' as const,
        qty: c.quantity,
        unitCost: c.cost != null && c.quantity ? c.cost / c.quantity : c.cost ?? 0,
        extCost: c.cost ?? 0,
        sortOrder: c.sort_order ?? 0,
      }))
    }
    if (subAssembly) {
      return (subAssembly.components ?? []).map((c) => ({
        partNumber: c.component_part_number,
        source: 'individual' as const,
        qty: c.quantity,
        unitCost: c.cost != null && c.quantity ? c.cost / c.quantity : c.cost ?? 0,
        extCost: c.cost ?? 0,
        sortOrder: c.sort_order ?? 0,
      }))
    }
    return []
  }, [finalAssembly, subAssembly])

  const sortedComponents = useMemo(
    () => [...components].sort((a, b) => a.sortOrder - b.sortOrder),
    [components],
  )

  // ── Loading ──
  if (loading) {
    return (
      <div id={id} role="region" aria-label={t('customerRef.bomLoading')} className="rounded-lg border border-border/40 bg-muted/25 px-4 py-8 text-center">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          {t('customerRef.bomLoading')}
        </div>
      </div>
    )
  }

  // ── Error ──
  if (errored) {
    return (
      <div id={id} role="region" aria-label={t('customerRef.bomFailed')} className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {t('customerRef.bomFailed')}
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={onRetry}>{t('customerRef.bomRetry')}</Button>
        </div>
      </div>
    )
  }

  // ── No BOM for this PN ──
  if (!kind) {
    return (
      <div id={id} role="region" aria-label={t('customerRef.noBom')} className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-6 py-8 text-center space-y-3">
        <div className="inline-flex items-center gap-2 text-sm text-amber-400">
          <AlertCircle className="size-4" />
          <span className="font-semibold">{t('customerRef.noBom')}</span>
          <span className="font-mono text-muted-foreground">· {partNumber}</span>
        </div>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          {t('customerRef.noBomHint')}
        </p>
        <Link
          href="/bom"
          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {t('customerRef.noBomCta')}
          <ExternalLink className="size-3" />
        </Link>
      </div>
    )
  }

  // ── Normal BOM render ──
  return (
    <div id={id} role="region" aria-label={t('customerRef.bomFor').replace('{pn}', partNumber)} className="rounded-lg border border-border/40 bg-gradient-to-br from-muted/30 via-muted/10 to-transparent p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
            {t('customerRef.bomFor').replace('{pn}', partNumber)}
          </h3>
          <KindBadge kind={kind} />
          {multiTier.length > 1 && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
              title={`${partNumber} also exists in: ${multiTier.filter((k) => k !== kind).join(', ')}`}
            >
              <AlertCircle className="size-3" />
              +{multiTier.length - 1}
            </span>
          )}
        </div>
        <Link
          href="/bom"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {t('customerRef.noBomCta')}
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {kind === 'individual' ? (
        // Individual item — no components, just a single info card
        <IndividualItemCard item={individualItem!} drawings={drawings} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Components table */}
          <div className="lg:col-span-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t('customerRef.bomComponents')}
            </h4>
            <div className="rounded-md border border-border/40 bg-card/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('customerRef.part')}</th>
                    <th className="px-2 py-2 font-medium">{t('customerRef.source')}</th>
                    <th className="px-2 py-2 font-medium text-right">{t('customerRef.qty')}</th>
                    <th className="px-2 py-2 font-medium text-right">{t('customerRef.unitCost')}</th>
                    <th className="px-2 py-2 font-medium text-right">{t('customerRef.extCost')}</th>
                    <th className="px-2 py-2 font-medium text-center w-[80px]">{t('customerRef.inventoryLabel')}</th>
                    <th className="px-2 py-2 font-medium text-center w-[80px]">{t('customerRef.drawingLabel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedComponents.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-xs text-muted-foreground">—</td></tr>
                  ) : sortedComponents.map((c) => {
                    const drawing = drawings.get(c.partNumber.trim().toUpperCase())
                    return (
                      <tr key={c.partNumber} className="border-t border-border/30 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 font-mono text-xs">{c.partNumber}</td>
                        <td className="px-2 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              c.source === 'sub'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-amber-500/20 text-amber-400'
                            }`}
                          >
                            {c.source === 'sub' ? t('customerRef.subAssembly') : t('customerRef.individualItem')}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{fmtQty(c.qty)}</td>
                        <td className="px-2 py-2 text-right font-mono text-xs text-muted-foreground">{fmt(c.unitCost)}</td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{fmt(c.extCost)}</td>
                        <td className="px-2 py-2 text-center">
                          <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
                            <InventoryPopover
                              partNumber={c.partNumber}
                              partType={inventoryChipKindFromDrawing(drawing?.productType)}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <DrawingIconButton partNumber={c.partNumber} drawingUrls={drawing?.drawingUrls ?? []} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cost breakdown */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t('customerRef.bomCostBreakdown')}
            </h4>
            {kind === 'final' && finalAssembly ? (
              <FinalCostBreakdown fa={finalAssembly} />
            ) : kind === 'sub' && subAssembly ? (
              <SubCostBreakdown sa={subAssembly} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function FinalCostBreakdown({ fa }: { fa: FinalAssemblyLite }) {
  const { t } = useI18n()
  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-3 space-y-1.5 text-sm">
      {fa.description && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t('customerRef.description')}:</span>
          <span className="text-right text-xs truncate max-w-[60%]">{fa.description}</span>
        </div>
      )}
      <CostLine label={t('customerRef.partsPerHour')} value={fa.parts_per_hour != null ? String(fa.parts_per_hour) : '—'} />
      <CostLine label={t('customerRef.laborPerPart')} value={fmt(fa.labor_cost_per_part)} />
      <CostLine label={t('customerRef.shipLabor')} value={fmt(fa.shipping_labor_cost)} />
      <hr className="border-border/60" />
      <CostLine label={t('customerRef.subtotal')} value={fmt(fa.subtotal_cost)} />
      <OverheadLine label={t('customerRef.overhead')} pctValue={fa.overhead_pct} cost={fa.overhead_cost} />
      <OverheadLine label={t('customerRef.admin')} pctValue={fa.admin_pct} cost={fa.admin_cost} />
      <OverheadLine label={t('customerRef.depreciation')} pctValue={fa.depreciation_pct} cost={fa.depreciation_cost} />
      <OverheadLine label={t('customerRef.repairs')} pctValue={fa.repairs_pct} cost={fa.repairs_cost} />
      <hr className="border-border/60" />
      <CostLine label={t('customerRef.variableCost')} value={fmt(fa.variable_cost)} />
      <CostLine label={t('customerRef.totalCost')} value={fmt(fa.total_cost)} emphasis />
      <OverheadLine label={t('customerRef.profitTarget')} pctValue={fa.profit_target_pct} cost={fa.profit_amount} />
      <div className="flex justify-between font-semibold text-emerald-400 pt-1">
        <span>{t('customerRef.salesTargetLabel')}:</span>
        <span className="font-mono">{fmt(fa.sales_target)}</span>
      </div>
    </div>
  )
}

function SubCostBreakdown({ sa }: { sa: SubAssemblyLite }) {
  const { t } = useI18n()
  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-3 space-y-1.5 text-sm">
      <CostLine label={t('customerRef.laborPerPart')} value={fmt(sa.labor_cost_per_part)} />
      <CostLine label={t('customerRef.overhead')} value={fmt(sa.overhead_cost)} />
      <hr className="border-border/60" />
      <CostLine label={t('customerRef.totalCost')} value={fmt(sa.total_cost)} emphasis />
    </div>
  )
}

function OverheadLine({ label, pctValue, cost }: { label: string; pctValue: number | null | undefined; cost: number | null | undefined }) {
  const pctLabel = pctValue != null ? `${(Number(pctValue) * 100).toFixed(1)}%` : '—'
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted-foreground">{label}:</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground/70">{pctLabel}</span>
        <span className="font-mono">{fmt(cost)}</span>
      </span>
    </div>
  )
}

function IndividualItemCard({ item, drawings }: { item: IndividualItemLite; drawings: Map<string, DrawingLite> }) {
  const { t } = useI18n()
  const drawing = drawings.get(item.part_number.trim().toUpperCase())
  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-4 grid grid-cols-2 gap-4 text-sm">
      <div>
        <div className="flex justify-between"><span className="text-muted-foreground">{t('customerRef.description')}:</span><span className="text-right text-xs">{item.description || '—'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{t('customerRef.unitCost')}:</span><span className="font-mono">{fmt(item.cost_per_unit)}</span></div>
        {item.supplier && <div className="flex justify-between"><span className="text-muted-foreground">{t('bom.supplier')}:</span><span className="text-xs">{item.supplier}</span></div>}
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t('customerRef.inventoryLabel')}</span>
          <InventoryPopover partNumber={item.part_number} partType="part" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t('customerRef.drawingLabel')}</span>
          <DrawingIconButton partNumber={item.part_number} drawingUrls={drawing?.drawingUrls ?? []} />
        </div>
      </div>
    </div>
  )
}

export default BomExpandPanel
