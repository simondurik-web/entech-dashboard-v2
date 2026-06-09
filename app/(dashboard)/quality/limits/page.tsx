"use client"

import { useEffect, useMemo, useState } from "react"
import { Pencil } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { METRICS_BY_TYPE, PRODUCT_TYPE_LABEL_KEY, PRODUCT_TYPES, type LimitRow, type ProductType } from "@/lib/quality/metrics"
import { userHeaders } from "@/lib/quality/form-utils"

type ProductRow = {
  product_type: ProductType
  product_number: string
  description: string | null
}

type DraftRow = { min: string; target: string; max: string }

function parseValue(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function rowToDraft(row?: LimitRow): DraftRow {
  return {
    min: row?.min_value != null ? String(row.min_value) : "",
    target: row?.target_value != null ? String(row.target_value) : "",
    max: row?.max_value != null ? String(row.max_value) : "",
  }
}

export default function QualityLimitsPage() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canEditLimits } = useQualityAccess()
  const [limits, setLimits] = useState<LimitRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ProductType | "all">("all")
  const [search, setSearch] = useState("")
  const [edit, setEdit] = useState<{ type: ProductType; number: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/quality/limits", { headers: userHeaders(profile?.id) })
      const json = await res.json()
      setLimits(json.limits || [])
      setProducts(json.products || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canEditLimits) load()
  }, [canEditLimits])

  const limitsByProduct = useMemo(() => {
    const out = new Map<string, Map<string, LimitRow>>()
    for (const row of limits) {
      const key = `${row.product_type}::${row.product_number}`
      if (!out.has(key)) out.set(key, new Map())
      out.get(key)?.set(row.metric_key, row)
    }
    return out
  }, [limits])

  const productsForView = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => filter === "all" || p.product_type === filter)
      .filter((p) => !q || p.product_number.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q) ?? false))
      .sort((a, b) => a.product_type.localeCompare(b.product_type) || a.product_number.localeCompare(b.product_number))
  }, [products, filter, search])

  if (!canEditLimits) return null

  return (
    <div className="p-4 pb-20">
      <h1 className="mb-1 text-2xl font-bold">{t("nav.qualityLimits")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("quality.admin.limitsSubtitle")}</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", ...PRODUCT_TYPES] as const).map((option) => (
          <Button key={option} size="sm" variant={filter === option ? "default" : "outline"} onClick={() => setFilter(option)}>
            {option === "all" ? t("quality.admin.all") : t(PRODUCT_TYPE_LABEL_KEY[option])}
          </Button>
        ))}
        <Input className="ml-auto w-full sm:w-64" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("quality.admin.search")} />
      </div>

      {loading && <p className="text-sm text-muted-foreground">{t("quality.admin.loading")}</p>}
      {!loading && productsForView.length === 0 && <p className="text-sm text-muted-foreground">{t("quality.admin.noProducts")}</p>}

      <div className="space-y-2">
        {productsForView.map((product) => {
          const byMetric = limitsByProduct.get(`${product.product_type}::${product.product_number}`) ?? new Map<string, LimitRow>()
          const metrics = METRICS_BY_TYPE[product.product_type]
          const hasAnyLimit = metrics.some((m) => {
            const row = byMetric.get(m.key)
            return row && (row.min_value != null || row.target_value != null || row.max_value != null)
          })
          return (
            <div key={`${product.product_type}::${product.product_number}`} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline">{t(PRODUCT_TYPE_LABEL_KEY[product.product_type])}</Badge>
                    <span className="font-mono text-sm">{product.product_number}</span>
                    {!hasAnyLimit && <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400">{t("quality.admin.noLimitsSet")}</Badge>}
                  </div>
                  {product.description && <p className="mb-2 text-xs text-muted-foreground">{product.description}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {metrics.map((metric) => {
                      const row = byMetric.get(metric.key)
                      const allNull = row?.min_value == null && row?.target_value == null && row?.max_value == null
                      return (
                        <div key={metric.key} className={allNull ? "text-muted-foreground/60" : "text-foreground"}>
                          <span className="text-muted-foreground">{t(metric.labelKey)}:</span>{" "}
                          {allNull ? "—" : (
                            <>
                              <span className="text-muted-foreground">{t("quality.admin.min")}</span> {row?.min_value ?? "—"} /{" "}
                              <span className="text-muted-foreground">{t("quality.form.target")}</span> {row?.target_value ?? "—"} /{" "}
                              <span className="text-muted-foreground">{t("quality.admin.max")}</span> {row?.max_value ?? "—"}
                              {metric.unit ? <span className="text-muted-foreground"> {metric.unit}</span> : null}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEdit({ type: product.product_type, number: product.product_number })}>
                  <Pencil className="mr-1.5 size-3.5" />{t("quality.admin.edit")}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {edit && (
        <EditLimitsDialog
          productType={edit.type}
          productNumber={edit.number}
          currentByMetric={limitsByProduct.get(`${edit.type}::${edit.number}`) ?? new Map()}
          onClose={() => setEdit(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  )
}

function EditLimitsDialog({
  productType,
  productNumber,
  currentByMetric,
  onClose,
  onSaved,
}: {
  productType: ProductType
  productNumber: string
  currentByMetric: Map<string, LimitRow>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const metrics = METRICS_BY_TYPE[productType]
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>(() => Object.fromEntries(metrics.map((m) => [m.key, rowToDraft(currentByMetric.get(m.key))])))
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update(metricKey: string, field: keyof DraftRow, value: string) {
    setDrafts((prev) => ({ ...prev, [metricKey]: { ...prev[metricKey], [field]: value } }))
    setError(null)
  }

  function rowError(metricKey: string): string | null {
    const draft = drafts[metricKey]
    const min = parseValue(draft.min)
    const target = parseValue(draft.target)
    const max = parseValue(draft.max)
    for (const [name, raw, parsed] of [["min", draft.min, min], ["target", draft.target, target], ["max", draft.max, max]] as const) {
      if (raw.trim() && parsed === null) return `${name}: ${t("quality.form.invalidNumber")}`
    }
    if (min !== null && max !== null && min > max) return t("quality.admin.errorMinMax")
    if (min !== null && target !== null && target < min) return t("quality.admin.errorTargetMin")
    if (target !== null && max !== null && target > max) return t("quality.admin.errorTargetMax")
    return null
  }

  function hasAnyChange(): boolean {
    return metrics.some((m) => {
      const draft = drafts[m.key]
      const current = currentByMetric.get(m.key)
      return parseValue(draft.min) !== (current?.min_value ?? null) ||
        parseValue(draft.target) !== (current?.target_value ?? null) ||
        parseValue(draft.max) !== (current?.max_value ?? null)
    })
  }

  async function handleSave() {
    setError(null)
    if (!reason.trim()) {
      setError(t("quality.admin.reasonRequired"))
      return
    }
    for (const metric of metrics) {
      const err = rowError(metric.key)
      if (err) {
        setError(`${t(metric.labelKey)}: ${err}`)
        return
      }
    }
    if (!hasAnyChange()) {
      setError(t("quality.admin.noChanges"))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/quality/limits", {
        method: "PATCH",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          product_type: productType,
          product_number: productNumber,
          reason: reason.trim(),
          changes: metrics.map((m) => ({ metric_key: m.key, min: parseValue(drafts[m.key].min), target: parseValue(drafts[m.key].target), max: parseValue(drafts[m.key].max) })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`)
        return
      }
      onSaved()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("quality.admin.editLimits")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t(PRODUCT_TYPE_LABEL_KEY[productType])} · <span className="font-mono">{productNumber}</span></p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-1 text-xs uppercase text-muted-foreground">
            <span>{t("quality.admin.metric")}</span><span>{t("quality.admin.min")}</span><span>{t("quality.form.target")}</span><span>{t("quality.admin.max")}</span>
          </div>
          {metrics.map((metric) => {
            const err = rowError(metric.key)
            const draft = drafts[metric.key]
            return (
              <div key={metric.key} className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] items-center gap-2">
                  <span className="text-sm">{t(metric.labelKey)}{metric.unit ? ` (${metric.unit})` : ""}</span>
                  <Input type="number" step="any" value={draft.min} onChange={(e) => update(metric.key, "min", e.target.value)} />
                  <Input type="number" step="any" value={draft.target} onChange={(e) => update(metric.key, "target", e.target.value)} />
                  <Input type="number" step="any" value={draft.max} onChange={(e) => update(metric.key, "max", e.target.value)} />
                </div>
                {err && <p className="px-1 text-xs text-destructive">{err}</p>}
              </div>
            )
          })}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("quality.admin.reason")} <span className="text-destructive">*</span></label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("quality.admin.reasonPlaceholder")} />
        </div>
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t("quality.admin.cancel")}</Button>
          <Button onClick={handleSave} disabled={submitting || !reason.trim()}>{submitting ? t("quality.form.submitting") : t("quality.admin.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
