"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
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
import { ProductAnalytics } from "@/components/quality/product-analytics"
import { EditInspectionModal, type QualityEditFieldDef } from "@/components/quality/edit-inspection-modal"
import { getBOMMappings } from "@/lib/quality/bom-mappings"

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

const finishedMetrics = [
  { key: "tire_od", labelKey: "quality.col.tireOd", unit: "mm" },
  { key: "tire_thickness", labelKey: "quality.col.tireThickness", unit: "mm" },
  { key: "tire_weight", labelKey: "quality.col.tireWeight", unit: "lbs" },
]

export default function QualityFinishedPage() {
  return <Suspense><QualityFinishedContent /></Suspense>
}

function QualityFinishedContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const { canSeeQuality, canManageQuality } = useQualityAccess()
  const [data, setData] = useState<FinRow[]>([])
  const [limits, setLimits] = useState<LimitsIndex>(new Map())
  const [bomMap, setBomMap] = useState<Record<string, { tire: string | null; hub: string | null }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editRecord, setEditRecord] = useState<FinRow | null>(null)

  const loadData = useCallback(async () => {
    const [rows, idx, mappings] = await Promise.all([
      fetchAllQa<FinRow>("qa_finished_inspections"),
      fetchLimitsIndex(),
      getBOMMappings(),
    ])
    const map: Record<string, { tire: string | null; hub: string | null }> = {}
    mappings.forEach((mapping) => { map[mapping.rtNumber] = { tire: mapping.tire, hub: mapping.hub } })
    setData(rows)
    setLimits(idx)
    setBomMap(map)
  }, [])

  useEffect(() => {
    if (!canSeeQuality) return
    let alive = true
    loadData()
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [canSeeQuality, loadData])

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
  const editFields: QualityEditFieldDef[] = useMemo(() => [
    { key: "timestamp", label: t("quality.colDate"), type: "text", readOnly: true },
    { key: "inspector_name", label: t("quality.colInspector"), type: "text", readOnly: true },
    { key: "rt_number", label: t("quality.col.rtNumber"), type: "text" },
    { key: "correct_tire", label: t("quality.col.correctTire"), type: "select", options: ["YES", "NO", "PASS", "FAIL"] },
    { key: "correct_hub", label: t("quality.col.correctHub"), type: "select", options: ["YES", "NO", "PASS", "FAIL"] },
    { key: "correct_hub_color", label: t("quality.col.correctHubColor"), type: "select", options: ["YES", "NO", "PASS", "FAIL"] },
    { key: "tire_od", label: `${t("quality.col.tireOd")} (mm)`, type: "number" },
    { key: "tire_thickness", label: `${t("quality.col.tireThickness")} (mm)`, type: "number" },
    { key: "tire_weight", label: `${t("quality.col.tireWeight")} (lbs)`, type: "number" },
    { key: "bore_check", label: t("quality.col.boreCheck"), type: "select", options: ["PASS", "FAIL"] },
    { key: "locking_mechanism", label: t("quality.col.lockingMechanism"), type: "select", options: ["PASS", "FAIL"] },
    { key: "tire_visual", label: t("quality.col.tireVisual"), type: "select", options: ["PASS", "FAIL"] },
    { key: "hub_visual", label: t("quality.col.hubVisual"), type: "select", options: ["PASS", "FAIL"] },
    { key: "comments", label: t("quality.col.comments"), type: "text" },
  ], [t])
  const analyticsMetrics = useMemo(() => finishedMetrics.map((m) => ({ key: m.key, label: t(m.labelKey), unit: m.unit })), [t])

  return (
    <div className="p-4 pb-20">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">{t("nav.qualityFinished")}</h1>
          <p className="text-muted-foreground text-sm">{t("quality.page.finishedSubtitle")}</p>
        </div>
        {canSeeQuality && (
          <Button asChild>
            <Link href="/quality/finished/new"><Plus className="mr-2 size-4" />{t("quality.form.new")}</Link>
          </Button>
        )}
      </div>
      {loading && <TableSkeleton rows={8} />}
      {error && <p className="text-center text-destructive py-10">{t("quality.loadError")}</p>}
      {!loading && !error && (
        <div className="space-y-4">
          <ProductAnalytics
            data={data}
            productKey="rt_number"
            productLabel={t("quality.productType.finished")}
            metrics={analyticsMetrics}
            bomMapping={bomMap}
            productType="finished_product"
            limitsIndex={limits}
            onProductsChange={(selected) => {
              if (selected.length === 1) table.setSearch(selected[0])
              else if (selected.length === 0) table.setSearch("")
            }}
          />
          <DataTable table={table} data={data} noun={t("quality.noun.inspection")} exportFilename="finished-inspections.csv" page="quality-finished" initialView={initialView} autoExport={autoExport} pageSize={100} onRowClick={canManageQuality ? (row) => setEditRecord(row) : undefined} />
        </div>
      )}
      <EditInspectionModal
        record={editRecord}
        fields={editFields}
        apiEndpoint="/api/quality/inspections/finished"
        onClose={() => setEditRecord(null)}
        onSaved={() => { loadData().catch(() => setError(t("quality.loadError"))) }}
      />
    </div>
  )
}
