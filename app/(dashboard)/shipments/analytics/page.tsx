'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, CalendarRange } from 'lucide-react'
import { authHeaders } from '@/lib/session-token'
import { partFill, partVisual, patternDefsFor } from '@/lib/shipments/product-colors'
import { todayET } from '@/lib/shipments/et-date'
import type {
  ShipmentTotals,
  VolumeBucket,
  VolumeBucketSize,
} from '@/lib/shipments/types'
import { useI18n } from '@/lib/i18n'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'

interface VolumeResponse {
  buckets: VolumeBucket[]
  parts: string[]
  totals: ShipmentTotals
}

type RangePreset = 'month' | '30d' | '90d' | 'ytd' | 'all'

const BUCKETS: VolumeBucketSize[] = ['day', 'week', 'month', 'quarter', 'year']

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (preset === '30d') return { from: addDays(today, -29), to: today }
  if (preset === '90d') return { from: addDays(today, -89), to: today }
  if (preset === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  return { from: addDays(today, -1100), to: today }
}

function bucketLabelKey(bucket: VolumeBucketSize): string {
  return `shipments.bucket.${bucket}`
}

interface AnalyticsTooltipEntry {
  color?: string
  dataKey?: string | number
  name?: string | number
  value?: string | number
}

interface AnalyticsTooltipProps {
  active?: boolean
  label?: string | number
  payload?: AnalyticsTooltipEntry[]
  totalLabel: string
  /** dataKey (part_N) → the product's flat color — pattern-fill refs (url(#…))
   *  can't paint a tooltip swatch. */
  resolveColor: (dataKey: string) => string
}

function AnalyticsTooltip({
  active,
  payload,
  label,
  totalLabel,
  resolveColor,
}: AnalyticsTooltipProps) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0)

  return (
    <div className="max-w-xs rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-xl">
      <p className="mb-2 font-semibold">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-5">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: resolveColor(String(entry.dataKey)) }}
              />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="font-medium">{Number(entry.value ?? 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between gap-5 border-t pt-2 font-semibold">
        <span>{totalLabel}</span>
        <span>{total.toLocaleString()}</span>
      </div>
    </div>
  )
}

/** Legend swatch that shows the actual bar appearance — solid for Eco-Border,
 *  hatched for Curbs, dotted for anything else — so the family difference the
 *  chart encodes is also readable in the legend. */
function PartSwatch({ part }: { part: string }) {
  const visual = partVisual(part)
  return (
    <svg width="14" height="14" className="shrink-0 rounded-[3px]" role="presentation">
      <rect width="14" height="14" fill={visual.color} stroke={visual.stroke} strokeWidth="1" />
      {visual.family === 'curb' && (
        <g stroke="rgba(255,255,255,0.65)" strokeWidth="1.5">
          <line x1="-2" y1="6" x2="6" y2="-2" />
          <line x1="2" y1="12" x2="12" y2="2" />
          <line x1="8" y1="16" x2="16" y2="8" />
        </g>
      )}
      {visual.family === 'other' && (
        <g fill="rgba(255,255,255,0.7)">
          <circle cx="4" cy="4" r="1.3" />
          <circle cx="10" cy="10" r="1.3" />
          <circle cx="10" cy="4" r="1.3" />
          <circle cx="4" cy="10" r="1.3" />
        </g>
      )}
    </svg>
  )
}

export default function ShipmentsAnalyticsPage() {
  return (
    <Suspense>
      <ShipmentsAnalyticsContent />
    </Suspense>
  )
}

function ShipmentsAnalyticsContent() {
  const { t } = useI18n()
  const today = useMemo(() => todayET(), [])
  const [bucket, setBucket] = useState<VolumeBucketSize>('day')
  const [range, setRange] = useState(() => presetRange('30d', today))
  const [activePreset, setActivePreset] = useState<RangePreset | null>('30d')
  const [data, setData] = useState<VolumeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return
    const controller = new AbortController()

    async function loadVolume() {
      setLoading(true)
      setError(false)
      try {
        const params = new URLSearchParams({
          from: range.from,
          to: range.to,
          bucket,
        })
        const response = await fetch(`/api/shipments/volume?${params}`, {
          headers: authHeaders(),
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Request failed: ${response.status}`)
        setData((await response.json()) as VolumeResponse)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadVolume()
    return () => controller.abort()
  }, [bucket, range])

  const chartData = useMemo(
    () =>
      (data?.buckets ?? []).map((item) => {
        const row: Record<string, string | number> = {
          bucket: item.bucket,
          total: Number(item.units),
        }
        data?.parts.forEach((part, index) => {
          row[`part_${index}`] = Number(item.parts[part] ?? 0)
        })
        return row
      }),
    [data]
  )

  const presets = useMemo(
    () =>
      [
        ['month', 'shipments.rangeThisMonth'],
        ['30d', 'shipments.rangeLast30'],
        ['90d', 'shipments.rangeLast90'],
        ['ytd', 'shipments.rangeYtd'],
        ['all', 'shipments.rangeAll'],
      ] as const,
    []
  )

  return (
    <div className="p-4 pb-20 md:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-6 text-primary" />
          <h1 className="text-2xl font-bold">{t('shipments.analyticsTitle')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('shipments.analyticsSubtitle')}
        </p>
      </div>

      <section className="mb-5 rounded-xl border bg-card p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipments.groupBy')}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {BUCKETS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setBucket(option)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
                      bucket === option
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {t(bucketLabelKey(option))}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipments.dateRange')}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {presets.map(([preset, labelKey]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setActivePreset(preset)
                      setRange(presetRange(preset, today))
                    }}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
                      activePreset === preset
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-muted-foreground">
              <span className="mb-1 flex items-center gap-1">
                <CalendarRange className="size-3.5" />
                {t('shipments.from')}
              </span>
              <input
                type="date"
                value={range.from}
                max={range.to || today}
                onChange={(event) => {
                  setActivePreset(null)
                  setRange((current) => ({ ...current, from: event.target.value }))
                }}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              <span className="mb-1 flex items-center gap-1">
                <CalendarRange className="size-3.5" />
                {t('shipments.to')}
              </span>
              <input
                type="date"
                value={range.to}
                min={range.from}
                max={today}
                onChange={(event) => {
                  setActivePreset(null)
                  setRange((current) => ({ ...current, to: event.target.value }))
                }}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
        </div>
      </section>

      {loading && (
        <div className="h-[420px] animate-pulse rounded-xl border bg-muted/30" />
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
          {t('shipments.loadError')}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <ScrollReveal>
            <div className="mb-5 grid grid-cols-3 gap-3">
              <SpotlightCard className="rounded-xl p-3 text-center" spotlightColor="59,130,246">
                <p className="text-xl font-bold md:text-2xl">
                  {data.totals.units.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{t('shipments.units')}</p>
              </SpotlightCard>
              <SpotlightCard className="rounded-xl p-3 text-center" spotlightColor="34,197,94">
                <p className="text-xl font-bold md:text-2xl">
                  {data.totals.orders.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{t('shipments.orders')}</p>
              </SpotlightCard>
              <SpotlightCard className="rounded-xl p-3 text-center" spotlightColor="168,85,247">
                <p className="text-xl font-bold md:text-2xl">
                  {data.totals.lines.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{t('shipments.lines')}</p>
              </SpotlightCard>
            </div>
          </ScrollReveal>

          {chartData.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
              {t('shipments.noShipmentData')}
            </div>
          ) : (
            <>
              <ScrollReveal>
                <section className="rounded-xl border bg-card p-3 shadow-sm md:p-5">
                  <h2 className="mb-4 font-semibold">{t('shipments.unitsByProduct')}</h2>
                  <div className="h-[300px] md:h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <defs>
                          {patternDefsFor(data.parts).map((visual) => (
                            <pattern
                              key={visual.patternId}
                              id={visual.patternId ?? undefined}
                              patternUnits="userSpaceOnUse"
                              width="6"
                              height="6"
                              patternTransform={visual.family === 'curb' ? 'rotate(45)' : undefined}
                            >
                              <rect width="6" height="6" fill={visual.color} />
                              {visual.family === 'curb' ? (
                                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
                              ) : (
                                <circle cx="3" cy="3" r="1.2" fill="rgba(255,255,255,0.65)" />
                              )}
                            </pattern>
                          ))}
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                          opacity={0.45}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="bucket"
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={20}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          content={
                            <AnalyticsTooltip
                              totalLabel={t('shipments.total')}
                              resolveColor={(dataKey) => {
                                const index = Number(dataKey.replace('part_', ''))
                                const part = data.parts[index]
                                return part ? partVisual(part).color : '#64748b'
                              }}
                            />
                          }
                        />
                        <Legend
                          content={() => (
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 text-[11px] text-muted-foreground">
                              {data.parts.map((part) => (
                                <span key={part} className="inline-flex items-center gap-1.5">
                                  <PartSwatch part={part} />
                                  {part === 'Other' ? t('shipments.other') : part}
                                </span>
                              ))}
                            </div>
                          )}
                        />
                        {data.parts.map((part, index) => (
                          <Bar
                            key={part}
                            dataKey={`part_${index}`}
                            name={part === 'Other' ? t('shipments.other') : part}
                            stackId="shipments"
                            fill={partFill(part)}
                            stroke={partVisual(part).stroke}
                            strokeWidth={1}
                            radius={index === data.parts.length - 1 ? [3, 3, 0, 0] : 0}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </ScrollReveal>

              <ScrollReveal className="mt-5">
                <section className="rounded-xl border bg-card shadow-sm">
                  <div className="border-b px-4 py-3">
                    <h2 className="font-semibold">{t('shipments.bucketTotals')}</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left">
                          <th className="px-4 py-3 font-medium">{t('shipments.bucket')}</th>
                          <th className="px-4 py-3 text-right font-medium">{t('shipments.units')}</th>
                          <th className="px-4 py-3 text-right font-medium">{t('shipments.orders')}</th>
                          <th className="px-4 py-3 text-right font-medium">{t('shipments.lines')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.buckets.map((row) => (
                          <tr key={row.bucket} className="border-b last:border-0">
                            <td className="px-4 py-3 font-medium">{row.bucket}</td>
                            <td className="px-4 py-3 text-right">{Number(row.units).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{Number(row.orders).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{Number(row.lines).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </ScrollReveal>
            </>
          )}
        </>
      )}
    </div>
  )
}
