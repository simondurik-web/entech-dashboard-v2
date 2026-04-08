"use client"

import { useRef, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import type { QueueBucket } from "@/lib/rolltech-action-center/types"
import { BUCKET_CONFIG } from "@/lib/rolltech-action-center/types"
import {
  MessageSquareWarning,
  HelpCircle,
  ClipboardCheck,
  Ship,
  Clock,
  Eye,
  CheckCircle2,
  VolumeX,
} from "lucide-react"

const BUCKET_ICONS: Record<QueueBucket, React.ReactNode> = {
  needs_reply_today: <MessageSquareWarning className="size-4" />,
  needs_internal_decision: <HelpCircle className="size-4" />,
  ready_to_process: <ClipboardCheck className="size-4" />,
  shipping_release_coordination: <Ship className="size-4" />,
  waiting_on_customer: <Clock className="size-4" />,
  needs_review: <Eye className="size-4" />,
  resolved: <CheckCircle2 className="size-4" />,
  noise: <VolumeX className="size-4" />,
}

interface BucketRailProps {
  activeBucket: QueueBucket | "all"
  onSelect: (bucket: QueueBucket | "all") => void
  bucketCounts: Record<QueueBucket, number>
  sortedBuckets: QueueBucket[]
}

export function BucketRail({ activeBucket, onSelect, bucketCounts, sortedBuckets }: BucketRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const totalActive = Object.entries(bucketCounts)
    .filter(([k]) => k !== "resolved" && k !== "noise")
    .reduce((sum, [, v]) => sum + v, 0)

  // All bucket items: "all" + sorted buckets
  const allItems = useMemo<(QueueBucket | "all")[]>(() => ["all", ...sortedBuckets], [sortedBuckets])

  const handleRailKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
      e.preventDefault()
      const currentIdx = allItems.indexOf(activeBucket)
      const nextIdx =
        e.key === "ArrowDown"
          ? (currentIdx + 1) % allItems.length
          : (currentIdx - 1 + allItems.length) % allItems.length
      onSelect(allItems[nextIdx])
      // Focus the next button
      const buttons = railRef.current?.querySelectorAll<HTMLButtonElement>("button")
      buttons?.[nextIdx]?.focus()
    },
    [activeBucket, allItems, onSelect]
  )

  return (
    <div ref={railRef} className="flex flex-col gap-0.5" role="listbox" aria-label="Queue buckets" onKeyDown={handleRailKeyDown}>
      {/* All active */}
      <button
        role="option"
        aria-selected={activeBucket === "all"}
        onClick={() => onSelect("all")}
        className={cn(
          "flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          activeBucket === "all"
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <span className="truncate">All Active</span>
        <span className="ml-2 tabular-nums text-xs font-medium opacity-70">{totalActive}</span>
      </button>

      <div className="my-1 border-t" />

      {sortedBuckets.map((bucket) => {
        const config = BUCKET_CONFIG[bucket]
        const count = bucketCounts[bucket] ?? 0
        const isActive = activeBucket === bucket

        return (
          <button
            key={bucket}
            role="option"
            aria-selected={isActive}
            onClick={() => onSelect(bucket)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <span className={cn("shrink-0", config.color)}>{BUCKET_ICONS[bucket]}</span>
            <span className="truncate text-left flex-1">{config.shortLabel}</span>
            <span
              className={cn(
                "ml-auto tabular-nums text-xs font-medium rounded-full min-w-[1.5rem] text-center px-1.5 py-0.5",
                count > 0 && bucket === "needs_reply_today"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  : "opacity-60"
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
