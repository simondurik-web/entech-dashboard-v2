"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { DailyDigest, WeeklyDigest, DigestItem } from "@/lib/rolltech-action-center/types"
import { PRIORITY_CONFIG } from "@/lib/rolltech-action-center/types"
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  VolumeX,
  Briefcase,
} from "lucide-react"

function DigestItemRow({ item }: { item: DigestItem }) {
  const priority = PRIORITY_CONFIG[(item.priority as keyof typeof PRIORITY_CONFIG) ?? "low"]
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className={cn("mt-0.5 shrink-0 size-1.5 rounded-full", priority.bg.replace("bg-", "bg-").replace("/30", ""))} style={{ backgroundColor: item.priority === "high" ? "#ef4444" : item.priority === "medium" ? "#f59e0b" : "#9ca3af" }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{item.subject}</p>
        <p className="text-[10px] text-muted-foreground truncate">{item.summary}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.reference && (
            <span className="text-[10px] text-muted-foreground font-mono">{item.reference}</span>
          )}
          {item.owner_hint && (
            <span className="text-[10px] text-muted-foreground">{item.owner_hint.split(" ")[0]}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function CollapsibleSection({
  title,
  count,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string
  count: number
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 py-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {icon}
        <span>{title}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
      </button>
      {open && <div className="ml-5 divide-y">{children}</div>}
    </div>
  )
}

interface DigestPreviewProps {
  daily: DailyDigest
  weekly: WeeklyDigest
}

export function DigestPreview({ daily, weekly }: DigestPreviewProps) {
  const [tab, setTab] = useState<"daily" | "weekly">("daily")

  return (
    <div className="flex flex-col gap-3">
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-0.5">
        <button
          onClick={() => setTab("daily")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "daily" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Calendar className="size-3" />
          Daily
        </button>
        <button
          onClick={() => setTab("weekly")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "weekly" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <CalendarDays className="size-3" />
          Weekly
        </button>
      </div>

      {tab === "daily" ? (
        <DailyView digest={daily} />
      ) : (
        <WeeklyView digest={weekly} />
      )}
    </div>
  )
}

function DailyView({ digest }: { digest: DailyDigest }) {
  const sectionIcons = [
    <AlertTriangle key="0" className="size-3 text-red-500" />,
    <AlertTriangle key="1" className="size-3 text-orange-500" />,
    <Briefcase key="2" className="size-3 text-blue-500" />,
    <TrendingUp key="3" className="size-3 text-cyan-500" />,
    <VolumeX key="4" className="size-3 text-gray-400" />,
  ]

  return (
    <div className="space-y-1">
      {/* Summary stat strip */}
      <div className="flex items-center gap-4 rounded-md bg-muted/50 px-3 py-2 mb-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold tabular-nums">{digest.total_items_surfaced}</span>
          <span className="text-[10px] text-muted-foreground">surfaced</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold tabular-nums">{digest.total_active}</span>
          <span className="text-[10px] text-muted-foreground">active</span>
        </div>
        <div className="flex items-baseline gap-1.5 ml-auto">
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{digest.total_suppressed}</span>
          <span className="text-[10px] text-muted-foreground">suppressed</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span>{digest.digest_date}</span>
        <span>v{digest.digest_version}</span>
      </div>

      {digest.sections.map((section, idx) => (
        <CollapsibleSection
          key={section.title}
          title={section.title}
          count={section.count}
          icon={sectionIcons[idx] ?? sectionIcons[0]}
          defaultOpen={idx < 3}
        >
          {section.items.map((item, i) => (
            <DigestItemRow key={i} item={item} />
          ))}
          {section.count > section.items.length && (
            <p className="text-[10px] text-muted-foreground py-1">
              +{section.count - section.items.length} more
            </p>
          )}
        </CollapsibleSection>
      ))}
    </div>
  )
}

function WeeklyView({ digest }: { digest: WeeklyDigest }) {
  const throughputDelta =
    digest.throughput.newly_resolved_count != null && digest.throughput.new_thread_count != null
      ? digest.throughput.newly_resolved_count - digest.throughput.new_thread_count
      : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span>Week ending {digest.week_ending}</span>
        <span>{digest.total_records} total records</span>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-md border px-2.5 py-2">
          <p className="text-lg font-semibold tabular-nums">{digest.total_active}</p>
          <p className="text-[10px] text-muted-foreground">Active</p>
        </div>
        <div className="rounded-md border px-2.5 py-2">
          <p className="text-lg font-semibold tabular-nums">{digest.throughput.resolved_count}</p>
          <p className="text-[10px] text-muted-foreground">Resolved</p>
        </div>
        <div className="rounded-md border px-2.5 py-2">
          <p className={cn("text-lg font-semibold tabular-nums", digest.at_risk.count > 0 ? "text-red-500" : "")}>{digest.at_risk.count}</p>
          <p className="text-[10px] text-muted-foreground">At Risk</p>
        </div>
        <div className="rounded-md border px-2.5 py-2">
          <p className="text-lg font-semibold tabular-nums">{digest.new_business.total_new_business}</p>
          <p className="text-[10px] text-muted-foreground">New Biz</p>
        </div>
      </div>

      {/* Throughput mini-bar */}
      {throughputDelta !== null && (
        <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-xs">
          <TrendingUp className={cn("size-3.5", throughputDelta >= 0 ? "text-green-500" : "text-amber-500")} />
          <span className="text-muted-foreground">
            {digest.throughput.newly_resolved_count ?? 0} resolved / {digest.throughput.new_thread_count ?? 0} new this week
          </span>
          <span className={cn("ml-auto font-medium tabular-nums", throughputDelta >= 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400")}>
            {throughputDelta >= 0 ? "+" : ""}{throughputDelta} net
          </span>
        </div>
      )}

      {/* At-risk threads */}
      {digest.at_risk.count > 0 && (
        <CollapsibleSection
          title="At-Risk Threads"
          count={digest.at_risk.count}
          icon={<AlertTriangle className="size-3 text-red-500" />}
        >
          {digest.at_risk.items.map((item, i) => (
            <DigestItemRow key={i} item={item} />
          ))}
        </CollapsibleSection>
      )}

      {/* New business */}
      {digest.new_business.total_new_business > 0 && (
        <CollapsibleSection
          title="New Business"
          count={digest.new_business.total_new_business}
          icon={<Briefcase className="size-3 text-green-500" />}
          defaultOpen={false}
        >
          {digest.new_business.rfq_threads.length > 0 && (
            <div className="py-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                RFQs ({digest.new_business.rfq_threads.length})
              </p>
              {digest.new_business.rfq_threads.slice(0, 3).map((item, i) => (
                <DigestItemRow key={i} item={item} />
              ))}
            </div>
          )}
          {digest.new_business.order_threads.length > 0 && (
            <div className="py-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                Orders ({digest.new_business.order_threads.length})
              </p>
              {digest.new_business.order_threads.slice(0, 3).map((item, i) => (
                <DigestItemRow key={i} item={item} />
              ))}
            </div>
          )}
          {digest.new_business.active_accounts.length > 0 && (
            <p className="text-[10px] text-muted-foreground py-1">
              Active accounts: {digest.new_business.active_accounts.slice(0, 5).join(", ")}
              {digest.new_business.active_accounts.length > 5 && ` +${digest.new_business.active_accounts.length - 5} more`}
            </p>
          )}
        </CollapsibleSection>
      )}

      {/* Open commitments by bucket */}
      <CollapsibleSection
        title="Open Commitments"
        count={digest.open_commitments.total}
        icon={<Briefcase className="size-3 text-blue-500" />}
        defaultOpen={false}
      >
        {Object.entries(digest.open_commitments.buckets).map(([bucket, items]) => (
          <div key={bucket} className="py-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
              {bucket.replace(/_/g, " ")} ({items.length})
            </p>
            {items.slice(0, 2).map((item, i) => (
              <DigestItemRow key={i} item={item} />
            ))}
            {items.length > 2 && (
              <p className="text-[10px] text-muted-foreground py-0.5">+{items.length - 2} more</p>
            )}
          </div>
        ))}
      </CollapsibleSection>

      {/* Noise/suppression */}
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <VolumeX className="size-3 text-muted-foreground" />
          <p className="font-medium">Suppression Report</p>
        </div>
        <p className="text-muted-foreground mt-0.5">
          {digest.noise_report.total_suppressed} suppressed ({Math.round(digest.noise_report.suppression_rate * 100)}% rate)
          — {digest.noise_report.noise_count} noise, {digest.noise_report.resolved_count} resolved
        </p>
      </div>
    </div>
  )
}
