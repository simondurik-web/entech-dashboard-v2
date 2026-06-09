"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { DataTable } from "@/components/data-table"
import { useDataTable, type ColumnDef } from "@/lib/use-data-table"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { useViewFromUrl, useAutoExport } from "@/lib/use-view-from-url"
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { fetchAllQa, fetchLimitsIndex } from "@/lib/quality/fetch"
import type { LimitsIndex } from "@/lib/quality/limits"
import { SpecValue, PassFail } from "@/components/quality/badges"

type FinRow = Record<string, unknown>

function fmtDate(v: unknown): string {
  if (!v) return "—"
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()
}
function str(v: unknown): string { return v == null ? "" : String(v) }
function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v))
  return Number.isNaN(n) ? null : n
}

export default function QualityFinishedPage() {
  return <Suspense><QualityFinishedContent /></Suspense>
}

function QualityFinishedContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const { canSeeQuality } = useQualityAccess()
  const [data, setData] = useState<FinRow[]>([])
  const [limits, setLimits] = useState<LimitsIndex>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canSeeQuality) return
    let alive = true
    Promise.all([fetchAllQa<FinRow>("qa_finished_inspections"), fetchLimitsIndex()])
      .then(([rows, idx]) => { if (!alive) return; setData(rows); setLimits(idx) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [canSeeQuality])

  const columns: ColumnDef<FinRow>[] = useMemo(() => {
    const spec = (key: string, metric: string): ColumnDef<FinRow> => ({
      key, label: t(`quality.col.${metric}`), sortable: true, filterable: true,
      render: (v, row) => (
        <SpecValue value={num(v)} index={limits} productType="finished_product" productNumber={str(row.rt_number)} metricKey={key} />
      ),
    })
    const pf = (key: string, metric: string): ColumnDef<FinRow> => ({
      key, label: t(`quality.col.${metric}`), sortable: true, filterable: true,
      render: (v) => <PassFail value={v} />,
    })
    return [
      { key: "timestamp", label: t("quality.colDate"), sortable: true, filterable: true, render: (v) => fmtDate(v) },
      { key: "inspector_name", label: t("quality.colInspector"), sortable: true, filterable: true },
      { key: "inspector_role", label: t("quality.colRole"), sortable: true, filterable: true, defaultHidden: true },
      { key: "rt_number", label: t("quality.col.rtNumber"), sortable: true, filterable: true, render: (v) => <span className="font-mono text-sm">{str(v) || "—"}</span> },
      pf("correct_tire", "correctTire"),
      pf("correct_hub", "correctHub"),
      pf("correct_hub_color", "correctHubColor"),
      spec("tire_od", "tireOd"),
      spec("tire_thickness", "tireThickness"),
      spec("tire_weight", "tireWeight"),
      pf("bore_check", "boreCheck"),
      pf("locking_mechanism", "lockingMechanism"),
      pf("tire_visual", "tireVisual"),
      pf("hub_visual", "hubVisual"),
      { key: "comments", label: t("quality.col.comments"), sortable: true, filterable: true, defaultHidden: true },
    ]
  }, [t, limits])

  const table = useDataTable({ data, columns, storageKey: "quality-finished" })

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-1">{t("nav.qualityFinished")}</h1>
      <p className="text-muted-foreground text-sm mb-4">{t("quality.page.finishedSubtitle")}</p>
      {loading && <TableSkeleton rows={8} />}
      {error && <p className="text-center text-destructive py-10">{t("quality.loadError")}</p>}
      {!loading && !error && (
        <DataTable table={table} data={data} noun="inspection" exportFilename="finished-inspections.csv" page="quality-finished" initialView={initialView} autoExport={autoExport} />
      )}
    </div>
  )
}
