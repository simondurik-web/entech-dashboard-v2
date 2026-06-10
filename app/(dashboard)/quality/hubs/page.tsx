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
import { SpecValue, PassFail, NeutralBadge } from "@/components/quality/badges"
import { ProductAnalytics } from "@/components/quality/product-analytics"
import { EditInspectionModal, type QualityEditFieldDef } from "@/components/quality/edit-inspection-modal"

type HubRow = Record<string, unknown>

function fmtDate(v: unknown): string {
  if (!v) return "—"
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()
}
function str(v: unknown): string {
  return v == null ? "" : String(v)
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : parseFloat(String(v))
  return Number.isNaN(n) ? null : n
}

const hubMetrics = [
  { key: "bore_size", labelKey: "quality.col.boreSize", unit: "mm", targetKey: "bore_size_target" },
  { key: "bore_length", labelKey: "quality.col.boreLength", unit: "mm", targetKey: "bore_length_target" },
  { key: "hub_diameter", labelKey: "quality.col.hubDiameter", unit: "mm", targetKey: "hub_diameter_target" },
  { key: "weight", labelKey: "quality.col.weight", unit: "lbs", targetKey: "weight_target" },
]

export default function QualityHubsPage() {
  return <Suspense><QualityHubsContent /></Suspense>
}

function QualityHubsContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const { canSeeQuality, canManageQuality } = useQualityAccess()
  const [data, setData] = useState<HubRow[]>([])
  const [limits, setLimits] = useState<LimitsIndex>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editRecord, setEditRecord] = useState<HubRow | null>(null)

  const loadData = useCallback(async () => {
    const [rows, idx] = await Promise.all([fetchAllQa<HubRow>("qa_hub_inspections"), fetchLimitsIndex()])
    setData(rows)
    setLimits(idx)
  }, [])

  useEffect(() => {
    // Gate the read on confirmed Quality access (AccessGuard renders children
    // during the auth-loading window, so an ungated fetch would let a non-QA
    // user trigger QA reads).
    if (!canSeeQuality) return
    let alive = true
    loadData()
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [canSeeQuality, loadData])

  const columns: ColumnDef<HubRow>[] = useMemo(() => {
    const spec = (key: string, metric: string): ColumnDef<HubRow> => ({
      key, label: t(`quality.col.${metric}`), sortable: true, filterable: true,
      render: (v, row) => (
        <SpecValue value={num(v)} index={limits} productType="hub" productNumber={str(row.hub_number)} metricKey={key} />
      ),
    })
    return [
      { key: "timestamp", label: t("quality.colDate"), sortable: true, filterable: true, render: (v) => fmtDate(v) },
      { key: "inspector_name", label: t("quality.colInspector"), sortable: true, filterable: true },
      { key: "inspector_role", label: t("quality.colRole"), sortable: true, filterable: true, defaultHidden: true },
      { key: "hub_number", label: t("quality.col.hubNumber"), sortable: true, filterable: true, render: (v) => <span className="font-mono text-sm">{str(v) || "—"}</span> },
      { key: "hub_style", label: t("quality.col.hubStyle"), sortable: true, filterable: true, render: (v) => v ? <NeutralBadge value={v} /> : "—" },
      { key: "mold_cavity", label: t("quality.col.moldCavity"), sortable: true, filterable: true, render: (v) => str(v) || "—" },
      spec("bore_size", "boreSize"),
      spec("bore_length", "boreLength"),
      spec("hub_diameter", "hubDiameter"),
      spec("weight", "weight"),
      { key: "locking_mechanism", label: t("quality.col.lockingMechanism"), sortable: true, filterable: true, render: (v) => <PassFail value={v} /> },
      { key: "visual_inspection", label: t("quality.col.visualInspection"), sortable: true, filterable: true, render: (v) => <PassFail value={v} /> },
      { key: "comments", label: t("quality.col.comments"), sortable: true, filterable: true, defaultHidden: true },
    ]
  }, [t, limits])

  const table = useDataTable({ data, columns, storageKey: "quality-hubs" })
  const editFields: QualityEditFieldDef[] = useMemo(() => [
    { key: "timestamp", label: t("quality.colDate"), type: "text", readOnly: true },
    { key: "inspector_name", label: t("quality.colInspector"), type: "text", readOnly: true },
    { key: "hub_number", label: t("quality.col.hubNumber"), type: "text" },
    { key: "hub_style", label: t("quality.col.hubStyle"), type: "text", readOnly: true },
    { key: "hub_mold", label: t("quality.col.hubMold"), type: "text", readOnly: true },
    { key: "mold_cavity", label: t("quality.col.moldCavity"), type: "select", options: ["1", "2", "3", "4"] },
    { key: "bore_size", label: `${t("quality.col.boreSize")} (mm)`, type: "number" },
    { key: "bore_size_target", label: `${t("quality.col.boreSize")} ${t("quality.form.target")}`, type: "number" },
    { key: "bore_length", label: `${t("quality.col.boreLength")} (mm)`, type: "number" },
    { key: "bore_length_target", label: `${t("quality.col.boreLength")} ${t("quality.form.target")}`, type: "number" },
    { key: "hub_diameter", label: `${t("quality.col.hubDiameter")} (mm)`, type: "number" },
    { key: "hub_diameter_target", label: `${t("quality.col.hubDiameter")} ${t("quality.form.target")}`, type: "number" },
    { key: "weight", label: `${t("quality.col.weight")} (lbs)`, type: "number" },
    { key: "weight_target", label: `${t("quality.col.weight")} ${t("quality.form.target")}`, type: "number" },
    { key: "locking_mechanism", label: t("quality.col.lockingMechanism"), type: "select", options: ["PASS", "FAIL", "N/A"] },
    { key: "visual_inspection", label: t("quality.col.visualInspection"), type: "select", options: ["PASS", "FAIL"] },
    { key: "comments", label: t("quality.col.comments"), type: "text" },
  ], [t])
  const analyticsMetrics = useMemo(() => hubMetrics.map((m) => ({ key: m.key, label: t(m.labelKey), unit: m.unit, targetKey: m.targetKey })), [t])

  return (
    <div className="p-4 pb-20">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">{t("nav.qualityHubs")}</h1>
          <p className="text-muted-foreground text-sm">{t("quality.page.hubsSubtitle")}</p>
        </div>
        {canSeeQuality && (
          <Button asChild>
            <Link href="/quality/hubs/new"><Plus className="mr-2 size-4" />{t("quality.form.new")}</Link>
          </Button>
        )}
      </div>
      {loading && <TableSkeleton rows={8} />}
      {error && <p className="text-center text-destructive py-10">{t("quality.loadError")}</p>}
      {!loading && !error && (
        <div className="space-y-4">
          <ProductAnalytics
            data={data}
            productKey="hub_number"
            productLabel={t("quality.productType.hub")}
            metrics={analyticsMetrics}
            productType="hub"
            limitsIndex={limits}
            onProductsChange={(selected) => {
              if (selected.length === 1) table.setSearch(selected[0])
              else if (selected.length === 0) table.setSearch("")
            }}
          />
          <DataTable
            table={table}
            data={data}
            noun={t("quality.noun.inspection")}
            exportFilename="hub-inspections.csv"
            page="quality-hubs"
            initialView={initialView}
            autoExport={autoExport}
            pageSize={100}
            onRowClick={canManageQuality ? (row) => setEditRecord(row) : undefined}
          />
        </div>
      )}
      <EditInspectionModal
        record={editRecord}
        fields={editFields}
        apiEndpoint="/api/quality/inspections/hubs"
        onClose={() => setEditRecord(null)}
        onSaved={() => { loadData().catch(() => setError(t("quality.loadError"))) }}
      />
    </div>
  )
}
