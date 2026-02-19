'use client'

import { useEffect, useState, useCallback } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Search, Package, TrendingUp, TrendingDown, Minus, ExternalLink, X, AlertTriangle } from 'lucide-react'
import type { InventoryItem } from '@/lib/google-sheets'
import { useI18n } from '@/lib/i18n'
import Link from 'next/link'

// ─── Shared inventory cache (singleton across all popovers) ───
let inventoryCache: InventoryItem[] | null = null
let inventoryPromise: Promise<InventoryItem[]> | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60_000 // 1 minute

async function getInventory(): Promise<InventoryItem[]> {
  const now = Date.now()
  if (inventoryCache && now - cacheTimestamp < CACHE_TTL) return inventoryCache
  if (inventoryPromise) return inventoryPromise

  inventoryPromise = fetch('/api/inventory')
    .then((res) => res.json())
    .then((data: InventoryItem[]) => {
      inventoryCache = data
      cacheTimestamp = Date.now()
      inventoryPromise = null
      return data
    })
    .catch((err) => {
      inventoryPromise = null
      throw err
    })
  return inventoryPromise
}

function findPart(items: InventoryItem[], partNumber: string): InventoryItem | null {
  const normalized = partNumber.trim().toUpperCase()
  return items.find((i) => i.partNumber.trim().toUpperCase() === normalized) || null
}

// ─── Status helpers ───

function stockStatus(item: InventoryItem, t: (key: string) => string): { label: string; color: string; bgColor: string; icon: React.ReactNode } {
  const { inStock, minimum, target } = item
  const effectiveTarget = target > 0 ? target : minimum

  if (inStock <= 0) {
    return { label: t('inventoryPopover.outOfStock'), color: 'text-red-400', bgColor: 'bg-red-500/15', icon: <AlertTriangle className="size-3" /> }
  }
  if (minimum > 0 && inStock < minimum) {
    return { label: t('inventoryPopover.belowMin'), color: 'text-red-400', bgColor: 'bg-red-500/15', icon: <TrendingDown className="size-3" /> }
  }
  if (effectiveTarget > 0 && inStock < effectiveTarget) {
    return { label: t('inventoryPopover.lowStock'), color: 'text-amber-400', bgColor: 'bg-amber-500/15', icon: <TrendingDown className="size-3" /> }
  }
  return { label: t('inventoryPopover.ok'), color: 'text-emerald-400', bgColor: 'bg-emerald-500/15', icon: <TrendingUp className="size-3" /> }
}

function stockPercentage(item: InventoryItem): number | null {
  const target = item.target > 0 ? item.target : item.minimum
  if (target <= 0) return null
  return Math.min(100, Math.round((item.inStock / target) * 100))
}

function barColor(pct: number): string {
  if (pct <= 25) return 'bg-red-500'
  if (pct <= 50) return 'bg-amber-500'
  if (pct <= 75) return 'bg-yellow-400'
  return 'bg-emerald-500'
}

// ─── Stat row ───
function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-[3px]">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${accent || 'text-foreground'}`}>{value}</span>
    </div>
  )
}

// ─── Main Component ───

interface InventoryPopoverProps {
  /** The part number to look up */
  partNumber: string
  /** What type of part this is (for display) */
  partType?: 'part' | 'tire' | 'hub'
}

export function InventoryPopover({ partNumber, partType = 'part' }: InventoryPopoverProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const loadData = useCallback(async () => {
    if (!partNumber) return
    setLoading(true)
    setError(false)
    try {
      const items = await getInventory()
      setItem(findPart(items, partNumber))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [partNumber])

  useEffect(() => {
    if (open) loadData()
  }, [open, loadData])

  if (!partNumber || partNumber === '-') return null

  const typeLabel = partType === 'tire' ? 'Tire' : partType === 'hub' ? 'Hub' : 'Part'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          className="inline-flex items-center justify-center size-[18px] rounded-[4px] text-[10px] leading-none
                     bg-muted/50 hover:bg-primary/20 hover:text-primary
                     text-muted-foreground/60 transition-all duration-150
                     hover:scale-110 active:scale-95 shrink-0"
          title={`View ${typeLabel.toLowerCase()} inventory`}
        >
          <Search className="size-[11px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[240px] p-0 overflow-hidden border-border/60 shadow-xl"
        align="start"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/40">
          <div className="flex items-center gap-1.5 min-w-0">
            <Package className="size-3 text-primary shrink-0" />
            <span className="text-[11px] font-semibold truncate">{partNumber}</span>
            <span className="text-[9px] text-muted-foreground/60 uppercase shrink-0">{typeLabel}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false) }}
            className="rounded-md p-0.5 hover:bg-muted transition-colors shrink-0"
          >
            <X className="size-3 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-3 py-2">
          {loading && (
            <div className="flex items-center gap-2 py-3 justify-center">
              <div className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-[11px] text-muted-foreground">{t('inventoryPopover.loading')}</span>
            </div>
          )}

          {error && (
            <p className="text-[11px] text-destructive text-center py-3">{t('inventoryPopover.failedToLoad')}</p>
          )}

          {!loading && !error && !item && (
            <p className="text-[11px] text-muted-foreground text-center py-3">{t('inventoryPopover.noData')}</p>
          )}

          {!loading && !error && item && (() => {
            const status = stockStatus(item, t)
            const pct = stockPercentage(item)

            return (
              <div className="space-y-2">
                {/* Status badge */}
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.color} ${status.bgColor}`}>
                  {status.icon}
                  {status.label}
                </div>

                {/* Stock bar */}
                {pct !== null && (
                  <div className="space-y-0.5">
                    <div className="h-[6px] w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-muted-foreground/60 text-right">{pct}% {t('inventoryPopover.ofTarget')}</p>
                  </div>
                )}

                {/* Stats */}
                <div className="divide-y divide-border/30">
                  <Stat label={t('inventoryPopover.inStock')} value={item.inStock.toLocaleString()} accent={item.inStock <= 0 ? 'text-red-400' : item.minimum > 0 && item.inStock < item.minimum ? 'text-amber-400' : 'text-emerald-400'} />
                  <Stat label={t('inventoryPopover.minimums')} value={item.minimum > 0 ? item.minimum.toLocaleString() : '—'} />
                  <Stat label={t('inventoryPopover.manualTarget')} value={item.target > 0 ? item.target.toLocaleString() : '—'} />
                  {item.moldType && <Stat label={t('inventoryPopover.mold')} value={item.moldType} />}
                  {item.daysToMin !== null && item.daysToMin >= 0 && (
                    <Stat
                      label={t('inventoryPopover.daysToMin')}
                      value={item.daysToMin === 0 ? 'Now' : `${item.daysToMin}d`}
                      accent={item.daysToMin <= 7 ? 'text-red-400' : item.daysToMin <= 14 ? 'text-amber-400' : ''}
                    />
                  )}
                  {item.product && <Stat label={t('inventoryPopover.type')} value={item.product} />}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Footer — link to inventory page */}
        {!loading && !error && item && (
          <div className="border-t border-border/40 px-3 py-1.5 bg-muted/20">
            <Link
              href="/inventory"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors py-0.5"
            >
              {t('inventoryPopover.openInventory')}
              <ExternalLink className="size-[10px]" />
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default InventoryPopover
