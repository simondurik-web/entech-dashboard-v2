"use client"

import { Suspense } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { useActionCenter } from "@/lib/rolltech-action-center/use-action-center"
import { BucketRail } from "@/components/rolltech-action-center/BucketRail"
import { ActionList } from "@/components/rolltech-action-center/ActionList"
import { ActionDetail } from "@/components/rolltech-action-center/ActionDetail"
import { DigestPreview } from "@/components/rolltech-action-center/DigestPreview"
import { BUCKET_CONFIG } from "@/lib/rolltech-action-center/types"
import type { ViewMode } from "@/lib/rolltech-action-center/use-action-center"
import type { QueueBucket } from "@/lib/rolltech-action-center/types"
import {
  Search,
  LayoutList,
  Calendar,
  CalendarDays,
  RefreshCw,
  Inbox,
} from "lucide-react"

function KpiBar({
  bucketCounts,
}: {
  bucketCounts: Record<string, number>
}) {
  const kpis = [
    { label: "Reply Today", value: bucketCounts.needs_reply_today ?? 0, color: "text-red-500" },
    { label: "Internal", value: (bucketCounts.needs_internal_decision ?? 0), color: "text-orange-500" },
    { label: "Process", value: bucketCounts.ready_to_process ?? 0, color: "text-blue-500" },
    { label: "Shipping", value: bucketCounts.shipping_release_coordination ?? 0, color: "text-cyan-500" },
    { label: "Wait Cust", value: bucketCounts.waiting_on_customer ?? 0, color: "text-yellow-500" },
  ]

  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="flex items-center gap-1.5 shrink-0">
          <span className={cn("text-lg font-semibold tabular-nums", kpi.color)}>{kpi.value}</span>
          <span className="text-xs text-muted-foreground">{kpi.label}</span>
        </div>
      ))}
    </div>
  )
}

function ViewToggle({
  mode,
  onSelect,
}: {
  mode: ViewMode
  onSelect: (m: ViewMode) => void
}) {
  const options: { value: ViewMode; icon: React.ReactNode; label: string }[] = [
    { value: "queue", icon: <LayoutList className="size-3.5" />, label: "Queue" },
    { value: "daily-digest", icon: <Calendar className="size-3.5" />, label: "Daily" },
    { value: "weekly-digest", icon: <CalendarDays className="size-3.5" />, label: "Weekly" },
  ]

  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            mode === opt.value
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.icon}
          <span className="hidden sm:inline">{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

function MobileBucketTabs({
  activeBucket,
  onSelect,
  bucketCounts,
  sortedBuckets,
}: {
  activeBucket: QueueBucket | "all"
  onSelect: (bucket: QueueBucket | "all") => void
  bucketCounts: Record<QueueBucket, number>
  sortedBuckets: QueueBucket[]
}) {
  const totalActive = Object.entries(bucketCounts)
    .filter(([bucket]) => bucket !== "resolved" && bucket !== "noise")
    .reduce((sum, [, count]) => sum + count, 0)

  return (
    <div className="md:hidden -mx-4 overflow-x-auto px-4">
      <div className="flex gap-1.5 pb-1">
        <button
          onClick={() => onSelect("all")}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            activeBucket === "all"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground"
          )}
        >
          All Active {totalActive}
        </button>
        {sortedBuckets.map((bucket) => {
          const isActive = activeBucket === bucket
          const count = bucketCounts[bucket] ?? 0

          return (
            <button
              key={bucket}
              onClick={() => onSelect(bucket)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground"
              )}
            >
              {BUCKET_CONFIG[bucket].shortLabel} {count}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ActionCenterContent() {
  const {
    activeBucket,
    setActiveBucket,
    selectedRecord,
    handleSelectRecord,
    selectedId,
    search,
    setSearch,
    viewMode,
    setViewMode,
    filteredRecords,
    bucketCounts,
    sortedBuckets,
    dailyDigest,
    weeklyDigest,
  } = useActionCenter()
  const shownCount =
    viewMode === "queue"
      ? filteredRecords.length
      : viewMode === "daily-digest"
        ? dailyDigest.total_items_surfaced
        : weeklyDigest.total_records

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">RollTech Action Center</h1>
          <p className="text-xs text-muted-foreground">
            Seed data preview only. {shownCount} items shown, no writes enabled.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle mode={viewMode} onSelect={setViewMode} />
          <button
            disabled
            className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground opacity-50 cursor-not-allowed"
            title="Sync not wired — using seed data"
          >
            <RefreshCw className="size-3" />
            Sync
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-card px-4 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <KpiBar bucketCounts={bucketCounts} />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Daily {dailyDigest.digest_date}</span>
            <span className="hidden sm:inline">•</span>
            <span>Week ending {weeklyDigest.week_ending}</span>
          </div>
        </div>
      </div>

      {viewMode !== "queue" && (
        <div className="flex-1 overflow-y-auto rounded-lg border bg-card p-4">
          <DigestPreview daily={dailyDigest} weekly={weeklyDigest} />
        </div>
      )}

      {viewMode === "queue" && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search customer, PO, part, thread..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <MobileBucketTabs
            activeBucket={activeBucket}
            onSelect={setActiveBucket}
            bucketCounts={bucketCounts}
            sortedBuckets={sortedBuckets}
          />

          <div className="flex flex-1 gap-3 overflow-hidden">
            <div className="hidden md:block w-44 shrink-0 overflow-y-auto rounded-lg border bg-card p-2">
              <BucketRail
                activeBucket={activeBucket}
                onSelect={setActiveBucket}
                bucketCounts={bucketCounts}
                sortedBuckets={sortedBuckets}
              />
            </div>

            <div className="flex-1 min-w-0 overflow-y-auto rounded-lg border bg-card">
              <ActionList
                records={filteredRecords}
                selectedId={selectedId}
                onSelect={handleSelectRecord}
              />
            </div>

            <div className="hidden lg:block w-80 shrink-0 overflow-y-auto rounded-lg border bg-card p-3">
              {selectedRecord ? (
                <ActionDetail
                  record={selectedRecord}
                  onClose={() => handleSelectRecord(selectedRecord.action_record_id)}
                />
              ) : (
                <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full border p-3 text-muted-foreground">
                    <Inbox className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Select a thread</p>
                    <p className="text-xs text-muted-foreground">
                      Pick an item from the queue to inspect the action summary and reference context.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedRecord && (
            <div
              className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden"
              onClick={() => handleSelectRecord(selectedRecord.action_record_id)}
            >
              <div
                className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l bg-card p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <ActionDetail
                  record={selectedRecord}
                  onClose={() => handleSelectRecord(selectedRecord.action_record_id)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function RollTechActionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading action center...</div>}>
      <ActionCenterContent />
    </Suspense>
  )
}
