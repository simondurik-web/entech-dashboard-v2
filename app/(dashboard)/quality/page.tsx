"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useI18n } from "@/lib/i18n"
import { CircleDot, Disc, PackageCheck, AlertTriangle } from "lucide-react"

// Quality (EQDR) dashboard — ported from the standalone app. Counts come from
// head-only count queries; "recent inspections" merges the latest few rows from
// each inspection table and shows the 10 newest overall. Reads go directly
// through the shared Supabase client under RLS (same as the standalone app).

type RecentRow = {
  type: "hub" | "tire" | "finished"
  id: number
  identifier: string
  inspector: string
  ts: string | null
}

const TYPE_META = {
  hub: { icon: CircleDot, color: "text-blue-500 dark:text-blue-400", tKey: "quality.typeHub", href: "/quality/hubs" },
  tire: { icon: Disc, color: "text-emerald-500 dark:text-emerald-400", tKey: "quality.typeTire", href: "/quality/tires" },
  finished: { icon: PackageCheck, color: "text-amber-500 dark:text-amber-400", tKey: "quality.typeFinished", href: "/quality/finished" },
} as const

function fmtDate(ts: string | null): string {
  if (!ts) return "—"
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()
}

export default function QualityDashboardPage() {
  const { t } = useI18n()
  const [counts, setCounts] = useState<{ hub: number; tire: number; finished: number } | null>(null)
  const [recent, setRecent] = useState<RecentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [hubC, tireC, finC, hubR, tireR, finR] = await Promise.all([
          supabase.from("qa_hub_inspections").select("*", { count: "exact", head: true }),
          supabase.from("qa_tire_inspections").select("*", { count: "exact", head: true }),
          supabase.from("qa_finished_inspections").select("*", { count: "exact", head: true }),
          supabase.from("qa_hub_inspections").select("id,inspector_name,hub_number,timestamp").order("timestamp", { ascending: false }).limit(10),
          supabase.from("qa_tire_inspections").select("id,inspector_name,tire_number,timestamp").order("timestamp", { ascending: false }).limit(10),
          supabase.from("qa_finished_inspections").select("id,inspector_name,rt_number,timestamp").order("timestamp", { ascending: false }).limit(10),
        ])
        if (!alive) return
        if (hubC.error || tireC.error || finC.error) { setError(true); return }
        setCounts({ hub: hubC.count ?? 0, tire: tireC.count ?? 0, finished: finC.count ?? 0 })
        const merged: RecentRow[] = [
          ...(hubR.data ?? []).map((r) => ({ type: "hub" as const, id: r.id, identifier: r.hub_number ?? "—", inspector: r.inspector_name ?? "—", ts: r.timestamp })),
          ...(tireR.data ?? []).map((r) => ({ type: "tire" as const, id: r.id, identifier: r.tire_number ?? "—", inspector: r.inspector_name ?? "—", ts: r.timestamp })),
          ...(finR.data ?? []).map((r) => ({ type: "finished" as const, id: r.id, identifier: r.rt_number ?? "—", inspector: r.inspector_name ?? "—", ts: r.timestamp })),
        ]
        merged.sort((a, b) => new Date(b.ts ?? 0).getTime() - new Date(a.ts ?? 0).getTime())
        setRecent(merged.slice(0, 10))
      } catch {
        if (alive) setError(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const cards = useMemo(() => ([
    { key: "hub" as const, label: t("quality.totalHubs"), value: counts?.hub, meta: TYPE_META.hub },
    { key: "tire" as const, label: t("quality.totalTires"), value: counts?.tire, meta: TYPE_META.tire },
    { key: "finished" as const, label: t("quality.totalFinished"), value: counts?.finished, meta: TYPE_META.finished },
  ]), [counts, t])

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("quality.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("quality.subtitle")}</p>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{t("quality.loadError")}</p>}

      {/* Count cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map(({ key, label, value, meta }) => {
          const Icon = meta.icon
          return (
            <Link key={key} href={meta.href} className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-blue-500/40 hover:bg-accent">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{label}</p>
                <Icon className={`size-5 ${meta.color}`} />
              </div>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {loading || value == null ? "—" : value.toLocaleString()}
              </p>
            </Link>
          )
        })}
      </div>

      {/* NCR quick link */}
      <Link href="/quality/ncr" className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent">
        <AlertTriangle className="size-4 text-amber-500 dark:text-amber-400" />
        <span className="font-medium">{t("nav.qualityNcr")}</span>
      </Link>

      {/* Recent inspections */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">{t("quality.recentInspections")}</h2>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">…</div>
        ) : recent.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{t("quality.recentEmpty")}</div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => {
              const meta = TYPE_META[r.type]
              const Icon = meta.icon
              return (
                <li key={`${r.type}-${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`flex items-center gap-1.5 ${meta.color}`}>
                    <Icon className="size-4" />
                    <span className="text-xs font-medium">{t(meta.tKey)}</span>
                  </span>
                  <span className="font-mono">{r.identifier}</span>
                  <span className="text-muted-foreground">{r.inspector}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDate(r.ts)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
