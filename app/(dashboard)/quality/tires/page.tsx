"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { useDataTable, type ColumnDef } from "@/lib/use-data-table"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { useViewFromUrl, useAutoExport } from "@/lib/use-view-from-url"
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { fetchAllQa, fetchLimitsIndex } from "@/lib/quality/fetch"
import type { LimitsIndex } from "@/lib/quality/limits"
import { SpecValue, PassFail } from "@/components/quality/badges"

type TireRow = Record<string, unknown>

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

export default function QualityTiresPage() {
  return <Suspense><QualityTiresContent /></Suspense>
}

function QualityTiresContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const { canSeeQuality } = useQualityAccess()
  const [data, setData] = useState<TireRow[]>([])
  const [limits, setLimits] = useState<LimitsIndex>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canSeeQuality) return
    let alive = true
    Promise.all([fetchAllQa<TireRow>("qa_tire_inspections"), fetchLimitsIndex()])
      .then(([rows, idx]) => { if (!alive) return; setData(rows); setLimits(idx) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [canSeeQuality])

  const columns: ColumnDef<TireRow>[] = useMemo(() => {
    const spec = (key: string, metric: string): ColumnDef<TireRow> => ({
      key, label: t(`quality.col.${metric}`), sortable: true, filterable: true,
      render: (v, row) => (
        <SpecValue value={num(v)} index={limits} productType="tire" productNumber={str(row.tire_number)} metricKey={key} />
      ),
    })
    return [
      { key: "timestamp", label: t("quality.colDate"), sortable: true, filterable: true, render: (v) => fmtDate(v) },
      { key: "inspector_name", label: t("quality.colInspector"), sortable: true, filterable: true },
      { key: "inspector_role", label: t("quality.colRole"), sortable: true, filterable: true, defaultHidden: true },
      { key: "tire_number", label: t("quality.col.tireNumber"), sortable: true, filterable: true, render: (v) => <span className="font-mono text-sm">{str(v) || "—"}</span> },
      spec("thickness", "thickness"),
      spec("diameter", "diameter"),
      spec("weight", "weight"),
      { key: "visual_inspection", label: t("quality.col.visualInspection"), sortable: true, filterable: true, render: (v) => <PassFail value={v} /> },
      { key: "comments", label: t("quality.col.comments"), sortable: true, filterable: true, defaultHidden: true },
    ]
  }, [t, limits])

  const table = useDataTable({ data, columns, storageKey: "quality-tires" })

  return (
    <div className="p-4 pb-20">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">{t("nav.qualityTires")}</h1>
          <p className="text-muted-foreground text-sm">{t("quality.page.tiresSubtitle")}</p>
        </div>
        {canSeeQuality && (
          <Button asChild>
            <Link href="/quality/tires/new"><Plus className="mr-2 size-4" />{t("quality.form.new")}</Link>
          </Button>
        )}
      </div>
      {loading && <TableSkeleton rows={8} />}
      {error && <p className="text-center text-destructive py-10">{t("quality.loadError")}</p>}
      {!loading && !error && (
        <DataTable table={table} data={data} noun={t("quality.noun.inspection")} exportFilename="tire-inspections.csv" page="quality-tires" initialView={initialView} autoExport={autoExport} />
      )}
    </div>
  )
}
