"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { DataTable } from "@/components/data-table"
import { useDataTable, type ColumnDef } from "@/lib/use-data-table"
import { useI18n } from "@/lib/i18n"
import { useViewFromUrl, useAutoExport } from "@/lib/use-view-from-url"
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { fetchAllQa } from "@/lib/quality/fetch"
import { NcrStatusBadge, DefectBadge, NeutralBadge } from "@/components/quality/badges"

type NcrRow = Record<string, unknown>

function fmtDate(v: unknown): string {
  if (!v) return "—"
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()
}
function str(v: unknown): string { return v == null ? "" : String(v) }

export default function QualityNcrPage() {
  return <Suspense><QualityNcrContent /></Suspense>
}

function QualityNcrContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [data, setData] = useState<NcrRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // NCR rows are ordered by created_at (no `timestamp` column on this table).
    fetchAllQa<NcrRow>("qa_nonconformance_reports", "*", "created_at")
      .then((rows) => { if (alive) setData(rows) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const columns: ColumnDef<NcrRow>[] = useMemo(() => [
    { key: "ncr_number", label: t("quality.col.ncrNumber"), sortable: true, filterable: true, render: (v) => <span className="font-mono text-sm text-blue-600 dark:text-blue-400">{str(v) || "—"}</span> },
    { key: "created_at", label: t("quality.colDate"), sortable: true, filterable: true, render: (v) => fmtDate(v) },
    { key: "product_type", label: t("quality.col.productType"), sortable: true, filterable: true, render: (v) => v ? <NeutralBadge value={v} /> : "—" },
    { key: "product_number", label: t("quality.col.product"), sortable: true, filterable: true, render: (v) => str(v) || "—" },
    { key: "defect_type", label: t("quality.col.defectType"), sortable: true, filterable: true, render: (v) => <DefectBadge value={v} /> },
    { key: "quantity_affected", label: t("quality.col.quantityAffected"), sortable: true, filterable: true, render: (v) => str(v) || "—" },
    { key: "disposition", label: t("quality.col.disposition"), sortable: true, filterable: true, render: (v) => v ? <NeutralBadge value={v} /> : "—" },
    { key: "status", label: t("quality.col.status"), sortable: true, filterable: true, render: (v) => <NcrStatusBadge value={v} /> },
    { key: "reported_by", label: t("quality.col.reportedBy"), sortable: true, filterable: true },
    { key: "defect_description", label: t("quality.col.defectDescription"), sortable: true, filterable: true, defaultHidden: true },
    { key: "root_cause", label: t("quality.col.rootCause"), sortable: true, filterable: true, defaultHidden: true },
    { key: "corrective_action", label: t("quality.col.correctiveAction"), sortable: true, filterable: true, defaultHidden: true },
    { key: "preventive_action", label: t("quality.col.preventiveAction"), sortable: true, filterable: true, defaultHidden: true },
    { key: "hub_style", label: t("quality.col.hubStyle"), sortable: true, filterable: true, defaultHidden: true },
    { key: "hub_mold", label: t("quality.col.hubMold"), sortable: true, filterable: true, defaultHidden: true },
    { key: "mold_cavity", label: t("quality.col.moldCavity"), sortable: true, filterable: true, defaultHidden: true },
  ], [t])

  const table = useDataTable({ data, columns, storageKey: "quality-ncr" })

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-1">{t("nav.qualityNcr")}</h1>
      <p className="text-muted-foreground text-sm mb-4">{t("quality.page.ncrSubtitle")}</p>
      {loading && <TableSkeleton rows={8} />}
      {error && <p className="text-center text-destructive py-10">{t("quality.loadError")}</p>}
      {!loading && !error && (
        <DataTable table={table} data={data} noun="report" exportFilename="ncr-reports.csv" page="quality-ncr" initialView={initialView} autoExport={autoExport} />
      )}
    </div>
  )
}
