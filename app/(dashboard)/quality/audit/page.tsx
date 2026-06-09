"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { useDataTable, type ColumnDef } from "@/lib/use-data-table"
import { useI18n } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { useQualityAccess } from "@/lib/use-quality-access"
import { useAutoExport, useViewFromUrl } from "@/lib/use-view-from-url"
import { TableSkeleton } from "@/components/ui/skeleton-loader"

type AuditEntry = Record<string, unknown> & {
  id: number
  created_at: string
  changed_by: string | null
  changed_by_email: string | null
  table_name: string | null
  record_id: number | null
  field_name: string | null
  old_value: string | null
  new_value: string | null
  change_type: string | null
}

function fmtDate(value: unknown): string {
  if (!value) return "—"
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}

function str(value: unknown): string {
  return value == null || value === "" ? "—" : String(value)
}

export default function QualityAuditPage() {
  return <Suspense><QualityAuditContent /></Suspense>
}

function QualityAuditContent() {
  const { t } = useI18n()
  const { canManageQuality } = useQualityAccess()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!canManageQuality) return
    let alive = true
    async function loadAudit() {
      const { data, error } = await supabase
        .from("qa_audit_trail")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100)
      if (alive) {
        if (error) setError(true)
        setEntries((data || []) as AuditEntry[])
        setLoading(false)
      }
    }
    loadAudit()
    return () => { alive = false }
  }, [canManageQuality])

  const columns: ColumnDef<AuditEntry>[] = useMemo(() => [
    { key: "created_at", label: t("quality.admin.date"), sortable: true, filterable: true, render: (v) => fmtDate(v) },
    { key: "changed_by", label: t("quality.admin.user"), sortable: true, filterable: true, render: (v, row) => str(v || row.changed_by_email) },
    { key: "table_name", label: t("quality.admin.table"), sortable: true, filterable: true, render: (v) => <span className="font-mono text-xs">{str(v).replace("qa_", "")}</span> },
    { key: "record_id", label: t("quality.admin.recordId"), sortable: true, filterable: true, render: (v) => <span className="font-mono text-xs">{str(v)}</span> },
    { key: "field_name", label: t("quality.admin.field"), sortable: true, filterable: true },
    { key: "old_value", label: t("quality.admin.oldValue"), sortable: true, filterable: true, render: (v) => <span className="block max-w-48 truncate text-muted-foreground">{str(v)}</span> },
    { key: "new_value", label: t("quality.admin.newValue"), sortable: true, filterable: true, render: (v) => <span className="block max-w-48 truncate">{str(v)}</span> },
    {
      key: "change_type",
      label: t("quality.admin.action"),
      sortable: true,
      filterable: true,
      render: (v) => {
        const action = String(v || "—")
        const cls = action === "create"
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : action === "delete"
            ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
        return <Badge className={cls}>{action}</Badge>
      },
    },
  ], [t])

  const table = useDataTable({ data: entries, columns, storageKey: "quality-audit" })

  if (!canManageQuality) return null

  return (
    <div className="p-4 pb-20">
      <h1 className="mb-1 text-2xl font-bold">{t("nav.qualityAudit")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("quality.admin.auditSubtitle")}</p>
      {loading && <TableSkeleton rows={8} />}
      {error && <p className="py-10 text-center text-destructive">{t("quality.loadError")}</p>}
      {!loading && !error && (
        <DataTable table={table} data={entries} noun={t("quality.admin.entry")} exportFilename="quality-audit.csv" page="quality-audit" initialView={initialView} autoExport={autoExport} />
      )}
    </div>
  )
}
