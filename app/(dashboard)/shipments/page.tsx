'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  PackageCheck,
  Printer,
  Truck,
} from 'lucide-react'
import { authHeaders } from '@/lib/session-token'
import { todayET } from '@/lib/shipments/et-date'
import type {
  DeliverableFile,
  DeliverableKind,
  ShipmentSummary,
  ShipmentTotals,
  VolumeBucket,
} from '@/lib/shipments/types'
import { useI18n } from '@/lib/i18n'
import { useCountUp } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'

interface VolumeResponse {
  buckets: VolumeBucket[]
  parts: string[]
  totals: ShipmentTotals
}

interface DeliverablesResponse {
  date: string
  files: DeliverableFile[]
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function deliverableKey(kind: DeliverableKind): string {
  const keys: Record<DeliverableKind, string> = {
    'packing-fedex': 'shipments.filePackingFedex',
    'packing-ltl': 'shipments.filePackingLtl',
    labels: 'shipments.fileLabels',
    summary: 'shipments.fileRunSummary',
    other: 'shipments.fileOther',
  }
  return keys[kind]
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: authHeaders(),
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json() as Promise<T>
}

export default function ShipmentsOverviewPage() {
  return (
    <Suspense>
      <ShipmentsOverviewContent />
    </Suspense>
  )
}

function ShipmentsOverviewContent() {
  const { t } = useI18n()
  const today = useMemo(() => todayET(), [])
  const [summary, setSummary] = useState<ShipmentSummary | null>(null)
  const [volume, setVolume] = useState<VolumeResponse | null>(null)
  const [deliverables, setDeliverables] = useState<DeliverablesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true)
      setError(false)
      try {
        const from = addDays(today, -13)
        const [summaryResult, volumeResult, deliverableResult] = await Promise.all([
          fetchJson<ShipmentSummary>('/api/shipments/summary', signal),
          fetchJson<VolumeResponse>(
            `/api/shipments/volume?from=${from}&to=${today}&bucket=day`,
            signal
          ),
          // The print-files card is auxiliary — a storage hiccup must not blank
          // the stats/chart, so it degrades to an empty card instead of failing
          // the whole load.
          fetchJson<DeliverablesResponse>(
            `/api/shipments/deliverables?date=${today}`,
            signal
          ).catch((deliverableError) => {
            if ((deliverableError as Error).name === 'AbortError') throw deliverableError
            return { date: today, files: [] } as DeliverablesResponse
          }),
        ])
        setSummary(summaryResult)
        setVolume(volumeResult)
        setDeliverables(deliverableResult)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') setError(true)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    },
    [today]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const todayUnits = useCountUp(summary?.today.units ?? 0)
  const todayOrders = useCountUp(summary?.today.orders ?? 0)
  const weekUnits = useCountUp(summary?.thisWeek.units ?? 0)
  const weekOrders = useCountUp(summary?.thisWeek.orders ?? 0)
  const todayLtl = useCountUp(summary?.ltl.today ?? 0)
  const weekLtl = useCountUp(summary?.ltl.thisWeek ?? 0)

  const chartData = useMemo(
    () =>
      (volume?.buckets ?? []).map((bucket) => ({
        bucket: bucket.bucket.slice(5),
        units: Number(bucket.units),
      })),
    [volume]
  )

  const sourceEntries = useMemo(
    () => Object.entries(summary?.bySource ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    [summary]
  )

  return (
    <div className="p-4 pb-20 md:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <PackageCheck className="size-6 text-primary" />
          <h1 className="text-2xl font-bold">{t('shipments.overviewTitle')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('shipments.overviewSubtitle')}
        </p>
      </div>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
          <p className="text-sm text-destructive">{t('shipments.loadError')}</p>
          <button
            type="button"
            onClick={() => {
              const controller = new AbortController()
              void load(controller.signal)
            }}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t('shipments.tryAgain')}
          </button>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <ScrollReveal>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <SpotlightCard
                className="rounded-xl p-4"
                spotlightColor="34,197,94"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('shipments.today')}
                  </p>
                  <Truck className="size-5 text-emerald-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-bold">{todayUnits.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t('shipments.units')}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{todayOrders.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t('shipments.orders')}</p>
                  </div>
                </div>
              </SpotlightCard>

              <SpotlightCard
                className="rounded-xl p-4"
                spotlightColor="59,130,246"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('shipments.thisWeek')}
                  </p>
                  <CalendarDays className="size-5 text-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-bold">{weekUnits.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t('shipments.units')}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{weekOrders.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t('shipments.orders')}</p>
                  </div>
                </div>
              </SpotlightCard>

              <SpotlightCard
                className="rounded-xl p-4"
                spotlightColor="245,158,11"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('shipments.ltlLines')}
                  </p>
                  <Boxes className="size-5 text-amber-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-2xl font-bold">{todayLtl.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t('shipments.today')}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{weekLtl.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t('shipments.thisWeek')}</p>
                  </div>
                </div>
              </SpotlightCard>
            </div>
          </ScrollReveal>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <ScrollReveal>
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{t('shipments.last14Days')}</h2>
                    <p className="text-xs text-muted-foreground">
                      {t('shipments.volumeTeaser')}
                    </p>
                  </div>
                  <Link
                    href="/shipments/analytics"
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    {t('shipments.openAnalytics')}
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
                {chartData.length === 0 ? (
                  <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                    {t('shipments.noShipmentData')}
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                          opacity={0.45}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="bucket"
                          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'hsl(var(--muted) / 0.35)' }}
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar
                          dataKey="units"
                          name={t('shipments.units')}
                          fill="hsl(var(--primary))"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </ScrollReveal>

            <div className="space-y-5">
              <ScrollReveal>
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 className="size-5 text-primary" />
                    <h2 className="font-semibold">{t('shipments.bySource')}</h2>
                  </div>
                  {sourceEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('shipments.noShipmentData')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {sourceEntries.map(([source, values]) => (
                        <div key={source} className="rounded-lg bg-muted/40 p-3">
                          <p className="truncate text-sm font-medium">{source}</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              {t('shipments.today')}: {values.today.units.toLocaleString()}{' '}
                              {t('shipments.units')}
                            </span>
                            <span>
                              {t('shipments.thisWeek')}: {values.thisWeek.units.toLocaleString()}{' '}
                              {t('shipments.units')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </ScrollReveal>

              <ScrollReveal>
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Printer className="size-5 text-primary" />
                      <h2 className="font-semibold">{t('shipments.todaysPrintFiles')}</h2>
                    </div>
                    <Link
                      href="/shipments/print"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {t('shipments.openPrintFiles')}
                    </Link>
                  </div>
                  {(deliverables?.files.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('shipments.noPrintFilesToday')}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {deliverables?.files.map((file) => (
                        <li
                          key={file.path}
                          className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span className="truncate">{t(deliverableKey(file.kind))}</span>
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </ScrollReveal>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
