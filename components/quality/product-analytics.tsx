"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Download } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DrawingViewer } from "@/components/quality/drawing-viewer"
import { useI18n } from "@/lib/i18n"
import { computeSpecStatus, findLimit, type LimitsIndex } from "@/lib/quality/limits"
import type { ProductType } from "@/lib/quality/metrics"

const Model3DViewer = dynamic(() => import("@/components/quality/model-3d-viewer").then((m) => m.Model3DViewer), {
  ssr: false,
})

interface Metric {
  key: string
  label: string
  unit?: string
  targetKey: string
}

interface ProductAnalyticsProps<T> {
  data: T[]
  productKey: string
  productLabel: string
  metrics: Metric[]
  timestampKey?: string
  bomMapping?: Record<string, { tire: string | null; hub: string | null }>
  onProductsChange?: (selected: string[]) => void
  productType?: ProductType
  limitsIndex?: LimitsIndex
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function computeStats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, count: 0, stdDev: 0 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return { min, max, avg, count: values.length, stdDev: Math.sqrt(variance) }
}

const COLORS = [
  { stroke: "#2563eb", darkStroke: "#60a5fa" },
  { stroke: "#059669", darkStroke: "#34d399" },
  { stroke: "#d97706", darkStroke: "#fbbf24" },
  { stroke: "#dc2626", darkStroke: "#f87171" },
  { stroke: "#7c3aed", darkStroke: "#a78bfa" },
  { stroke: "#db2777", darkStroke: "#f472b6" },
]

export function ProductAnalytics<T extends Record<string, unknown>>({
  data,
  productKey,
  productLabel,
  metrics,
  timestampKey = "timestamp",
  bomMapping,
  onProductsChange,
  productType,
  limitsIndex,
}: ProductAnalyticsProps<T>) {
  const { t } = useI18n()
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [compareMode, setCompareMode] = useState(false)

  useEffect(() => {
    onProductsChange?.(selectedProducts)
    // Selection changes are the only meaningful trigger; callers often create
    // callbacks inline and should not reset analytics state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProducts])

  const products = useMemo(() => {
    const set = new Set<string>()
    data.forEach((row) => {
      const value = row[productKey]
      if (value) set.add(String(value))
    })
    return [...set].sort()
  }, [data, productKey])

  const statsPerProduct = useMemo(() => {
    const prods = selectedProducts.length > 0 ? selectedProducts : products.slice(0, 1)
    return prods.map((product) => {
      const rows = data.filter((row) => String(row[productKey]) === product)
      const metricStats = metrics.map((metric) => {
        const values = rows.map((row) => toNumber(row[metric.key])).filter((value): value is number => value != null)
        const rowTarget = rows.map((row) => toNumber(row[metric.targetKey])).find((value) => value != null) ?? null
        const currentLimit = productType && limitsIndex ? findLimit(limitsIndex, productType, product, metric.key) : null
        const limitMin = currentLimit?.min ?? null
        const limitMax = currentLimit?.max ?? null
        const target = currentLimit?.target ?? rowTarget
        const stats = computeStats(values)
        const avgStatus = stats.count > 0 ? computeSpecStatus(stats.avg, { min: limitMin, max: limitMax, target }) : "no_limit"
        let outOfSpec = 0
        if (productType && limitsIndex && (limitMin != null || limitMax != null)) {
          for (const row of rows) {
            const value = toNumber(row[metric.key])
            if (value == null) continue
            const status = computeSpecStatus(value, currentLimit)
            if (status === "red") outOfSpec++
          }
        }
        return { ...metric, ...stats, target, limitMin, limitMax, avgStatus, outOfSpec }
      })
      return { product, count: rows.length, metrics: metricStats }
    })
  }, [data, selectedProducts, products, productKey, metrics, productType, limitsIndex])

  const trendDataByProduct = useMemo(() => {
    if (selectedProducts.length === 0) return {} as Record<string, Record<string, unknown>[]>
    const result: Record<string, Record<string, unknown>[]> = {}
    selectedProducts.forEach((product) => {
      result[product] = data
        .filter((row) => String(row[productKey]) === product && row[timestampKey])
        .sort((a, b) => new Date(String(a[timestampKey])).getTime() - new Date(String(b[timestampKey])).getTime())
        .map((row) => {
          const ts = new Date(String(row[timestampKey]))
          const point: Record<string, unknown> = {
            timestamp: ts.getTime(),
            date: ts.toLocaleDateString(),
          }
          metrics.forEach((metric) => {
            point[metric.key] = toNumber(row[metric.key])
            const limit = productType && limitsIndex ? findLimit(limitsIndex, productType, product, metric.key) : null
            point[`__limitMin_${metric.key}`] = limit?.min ?? null
            point[`__limitMax_${metric.key}`] = limit?.max ?? null
            point[`__limitTarget_${metric.key}`] = limit?.target ?? toNumber(row[metric.targetKey])
          })
          return point
        })
    })
    return result
  }, [data, selectedProducts, productKey, timestampKey, metrics, productType, limitsIndex])

  const comparisonData = useMemo(() => {
    if (selectedProducts.length < 2) return []
    return metrics.map((metric) => {
      const point: Record<string, unknown> = { metric: metric.label }
      selectedProducts.forEach((product) => {
        const rows = data.filter((row) => String(row[productKey]) === product)
        const values = rows.map((row) => toNumber(row[metric.key])).filter((value): value is number => value != null)
        if (values.length > 0) point[product] = +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)
      })
      return point
    })
  }, [data, selectedProducts, productKey, metrics])

  const drawingParts = useMemo(() => {
    if (selectedProducts.length === 0) return { partNumbers: [] as string[], labels: [] as string[] }
    const keyed = new Map<string, string>()
    selectedProducts.forEach((product) => {
      const bom = bomMapping?.[product]
      if (bom) {
        keyed.set(product, `${t("quality.analytics.finalProduct")} ${product}`)
        if (bom.tire) keyed.set(bom.tire, `${t("quality.productType.tire")} ${bom.tire}`)
        if (bom.hub) keyed.set(bom.hub, `${t("quality.productType.hub")} ${bom.hub}`)
      } else {
        keyed.set(product, product)
      }
    })
    return { partNumbers: [...keyed.keys()], labels: [...keyed.values()] }
  }, [selectedProducts, bomMapping, t])

  const toggleProduct = (product: string) => {
    setSelectedProducts((prev) => prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product])
  }

  const exportPDF = () => {
    const printWindow = window.open("", "_blank")
    if (!printWindow) return
    const statsHtml = statsPerProduct.map((ps) => `
      <div style="margin-bottom:24px;">
        <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:16px;">${ps.product} <span style="color:#666;font-weight:normal;">(${ps.count} ${t("quality.analytics.inspections")})</span></h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr style="background:#eef2ff;"><th style="text-align:left;padding:10px;border:1px solid #d0d8e8;">${t("quality.analytics.dimension")}</th><th style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${t("quality.analytics.avg")}</th><th style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${t("quality.analytics.min")}</th><th style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${t("quality.analytics.max")}</th><th style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${t("quality.analytics.target")}</th><th style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${t("quality.analytics.status")}</th></tr>
          ${ps.metrics.map((metric) => {
            const inSpec = metric.avgStatus !== "red"
            return `<tr><td style="padding:10px;border:1px solid #d0d8e8;">${metric.label} ${metric.unit || ""}</td><td style="text-align:center;padding:10px;border:1px solid #d0d8e8;font-weight:bold;">${metric.avg.toFixed(2)}</td><td style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${metric.min.toFixed(2)}</td><td style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${metric.max.toFixed(2)}</td><td style="text-align:center;padding:10px;border:1px solid #d0d8e8;">${metric.target ?? "-"}</td><td style="text-align:center;padding:10px;border:1px solid #d0d8e8;color:${inSpec ? "#16a34a" : "#dc2626"};font-weight:bold;">${inSpec ? t("quality.analytics.inSpec") : t("quality.analytics.out")}</td></tr>`
          }).join("")}
        </table>
      </div>
    `).join("")
    printWindow.document.write(`<!doctype html><html><head><title>${t("quality.analytics.reportTitle")}</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#333;}h1{color:#1e3a5f;border-bottom:3px solid #2563eb;padding-bottom:12px;}@media print{body{padding:20px;}}</style></head><body><div style="display:flex;justify-content:space-between;align-items:center;"><h1>${t("quality.analytics.reportTitle")}</h1><span style="color:#666;">${new Date().toLocaleDateString()}</span></div><h2 style="color:#555;">${productLabel}: ${selectedProducts.join(", ")}</h2>${statsHtml}<p style="color:#888;font-size:11px;margin-top:40px;">${t("quality.analytics.generatedBy")}</p></body></html>`)
    printWindow.document.close()
    setTimeout(() => printWindow.print(), 500)
  }

  if (products.length === 0) return null

  return (
    <section className="space-y-4 rounded-md border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground sm:text-lg">
          {productLabel} {t("quality.analytics.title")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {selectedProducts.length >= 2 && (
            <Button type="button" variant={compareMode ? "default" : "outline"} size="sm" onClick={() => setCompareMode((value) => !value)}>
              {t("quality.analytics.compare")}
            </Button>
          )}
          {selectedProducts.length > 0 && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={exportPDF}>
                <Download className="mr-1 size-3.5" />
                PDF
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedProducts([])}>
                {t("quality.analytics.clear")}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
        {products.map((product) => (
          <button
            key={product}
            type="button"
            onClick={() => toggleProduct(product)}
            className={
              selectedProducts.includes(product)
                ? "rounded-md border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400"
                : "rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {product}
          </button>
        ))}
      </div>

      {selectedProducts.length > 0 && (
        <div className="space-y-4">
          {drawingParts.partNumbers.length > 0 && (
            <DrawingViewer partNumbers={drawingParts.partNumbers} labels={drawingParts.labels} />
          )}

          {selectedProducts.map((product) => (
            <Model3DViewer key={`3d-${product}`} partNumber={product} label={`${productLabel} ${product}`} />
          ))}

          {statsPerProduct.map((ps) => (
            <div key={ps.product} className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">
                {ps.product} <span className="text-muted-foreground">({ps.count} {t("quality.analytics.inspections")})</span>
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {ps.metrics.map((metric) => {
                  const inSpec = metric.avgStatus !== "red"
                  return (
                    <div key={metric.key} className="space-y-1 rounded-md border bg-background p-3">
                      <div className="text-[11px] font-medium uppercase text-muted-foreground">{metric.label}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xl font-bold tabular-nums">{metric.avg.toFixed(2)}</span>
                        {metric.unit && <span className="text-[10px] text-muted-foreground">{metric.unit}</span>}
                        <Badge className={inSpec ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"}>
                          {inSpec ? t("quality.analytics.inSpec") : t("quality.analytics.out")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{t("quality.analytics.recorded")}:</span>
                        <span>{t("quality.analytics.min")} {metric.min.toFixed(2)}</span>
                        <span>{t("quality.analytics.max")} {metric.max.toFixed(2)}</span>
                      </div>
                      {(metric.limitMin != null || metric.limitMax != null || metric.target != null) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <span>{t("quality.analytics.limit")}:</span>
                          <span>{t("quality.analytics.min")} {metric.limitMin ?? "-"}</span>
                          <span>{t("quality.analytics.tgt")} {metric.target ?? "-"}</span>
                          <span>{t("quality.analytics.max")} {metric.limitMax ?? "-"}</span>
                        </div>
                      )}
                      {(metric.limitMin != null || metric.limitMax != null) && metric.outOfSpec > 0 && (
                        <div className="text-[11px] text-red-600 dark:text-red-400">
                          {t("quality.analytics.outOfSpec")}: {metric.outOfSpec} / {metric.count}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {Object.keys(trendDataByProduct).length > 0 && !compareMode && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">{t("quality.analytics.trends")}</h3>
              {metrics.map((metric, metricIndex) => (
                <div key={metric.key} className="space-y-2 rounded-md border bg-background p-3">
                  <p className="text-[11px] font-medium uppercase text-muted-foreground">{metric.label}</p>
                  {selectedProducts.map((product, productIndex) => {
                    const prodData = trendDataByProduct[product]?.filter((point) => point[metric.key] != null) || []
                    if (prodData.length === 0) return null
                    const color = COLORS[productIndex % COLORS.length]
                    return (
                      <div key={product} className="h-[180px] min-w-0 sm:h-[220px]">
                        {selectedProducts.length > 1 && <p className="mb-1 text-[10px] text-muted-foreground">{product}</p>}
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={prodData}>
                            <defs>
                              <linearGradient id={`quality-grad-${productIndex}-${metricIndex}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color.stroke} stopOpacity={0.28} />
                                <stop offset="95%" stopColor={color.stroke} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={38} />
                            <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                            <Area dataKey={metric.key} stroke={color.stroke} fill={`url(#quality-grad-${productIndex}-${metricIndex})`} strokeWidth={2} dot={false} name={product} type="monotone" />
                            <Line type="stepAfter" dataKey={`__limitMin_${metric.key}`} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5} dot={false} isAnimationActive={false} name={t("quality.analytics.min")} connectNulls={false} />
                            <Line type="stepAfter" dataKey={`__limitMax_${metric.key}`} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={1.5} dot={false} isAnimationActive={false} name={t("quality.analytics.max")} connectNulls={false} />
                            <Line type="stepAfter" dataKey={`__limitTarget_${metric.key}`} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} dot={false} isAnimationActive={false} name={t("quality.analytics.target")} connectNulls={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {compareMode && comparisonData.length > 0 && (
            <div className="rounded-md border bg-background p-3">
              <h3 className="mb-3 text-sm font-medium text-foreground">{t("quality.analytics.averageComparison")}</h3>
              <div className="h-[260px] sm:h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                    <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} width={38} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Legend />
                    {selectedProducts.map((product, productIndex) => (
                      <Bar key={product} dataKey={product} fill={COLORS[productIndex % COLORS.length].stroke} fillOpacity={0.75} radius={[4, 4, 0, 0]} name={product} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
