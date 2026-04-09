"use client"

import { cn } from "@/lib/utils"
import type { ActionRecord } from "@/lib/rolltech-action-center/types"
import { BUCKET_CONFIG, PRIORITY_CONFIG, SIGNAL_BADGES, getDisplayName } from "@/lib/rolltech-action-center/types"
import { Paperclip, AlertTriangle } from "lucide-react"
import { useEffect, useRef, useCallback } from "react"

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return "<1h"
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

interface ActionListProps {
  records: ActionRecord[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ActionList({ records, selectedId, onSelect }: ActionListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keyboard navigation: ArrowUp/Down/j/k to move, Escape to deselect
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (records.length === 0) return
      const currentIdx = selectedId ? records.findIndex((r) => r.action_record_id === selectedId) : -1

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        const nextIdx = currentIdx < records.length - 1 ? currentIdx + 1 : 0
        onSelect(records[nextIdx].action_record_id)
        listRef.current?.querySelector(`[data-record-id="${records[nextIdx].action_record_id}"]`)?.scrollIntoView({ block: "nearest" })
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : records.length - 1
        onSelect(records[prevIdx].action_record_id)
        listRef.current?.querySelector(`[data-record-id="${records[prevIdx].action_record_id}"]`)?.scrollIntoView({ block: "nearest" })
      } else if (e.key === "Escape") {
        e.preventDefault()
        if (selectedId) onSelect(selectedId) // toggles off via parent handler
      }
    },
    [records, selectedId, onSelect]
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No action items match your filters.
      </div>
    )
  }

  return (
    <div ref={listRef} role="listbox" aria-label="Action records" className="divide-y">
      {records.map((record) => {
        const isSelected = record.action_record_id === selectedId
        const bucket = BUCKET_CONFIG[record.queue_bucket]
        const priority = PRIORITY_CONFIG[record.priority] ?? PRIORITY_CONFIG["low"]
        const age = timeAgo(record.last_meaningful_at)
        const displayName = getDisplayName(record)
        const refNums = [
          ...record.reference_numbers.po_numbers.map((p) => `PO ${p}`),
          ...record.reference_numbers.part_numbers.slice(0, 1),
        ]

        // Show max 3 signal badges
        const badges = record.signals
          .filter((s) => s in SIGNAL_BADGES)
          .slice(0, 3)
          .map((s) => SIGNAL_BADGES[s])

        return (
          <div
            key={record.action_record_id}
            role="option"
            aria-selected={isSelected}
            data-record-id={record.action_record_id}
            tabIndex={0}
            onClick={() => onSelect(record.action_record_id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(record.action_record_id) } }}
            className={cn(
              "flex w-full cursor-pointer flex-col gap-1 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              isSelected
                ? "bg-primary/5 border-l-2 border-primary"
                : "hover:bg-accent/50 border-l-2 border-transparent"
            )}
          >
            {/* Row 1: display name + age */}
            <div className="flex items-start gap-2">
              <span className="flex-1 truncate text-sm font-medium leading-tight">
                {displayName}
              </span>
              {age && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {age}
                </span>
              )}
            </div>

            {/* Row 2: action summary */}
            <p className="truncate text-xs text-muted-foreground">{record.action_summary}</p>

            {/* Row 3: metadata chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Priority dot */}
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                  priority.bg,
                  priority.color
                )}
              >
                {priority.label}
              </span>

              {/* Bucket */}
              <span className={cn("text-[10px]", bucket.color)}>{bucket.shortLabel}</span>

              {/* Owner */}
              {record.owner_hint && (
                <span className="text-[10px] text-muted-foreground">
                  {record.owner_hint.split(" ")[0]}
                </span>
              )}

              {/* Signal badges */}
              {badges.map((b) => (
                <span
                  key={b.label}
                  className={cn(
                    "rounded px-1 py-0.5 text-[10px] font-medium",
                    b.variant === "destructive"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {b.label}
                </span>
              ))}

              {/* Ref numbers */}
              {refNums.length > 0 && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                  {refNums.join(" / ")}
                </span>
              )}

              {/* Attachments icon */}
              {record.has_attachments && (
                <Paperclip className="size-3 text-muted-foreground" />
              )}

              {/* Due warning */}
              {record.due_at && (
                <AlertTriangle className="size-3 text-amber-500" />
              )}

              {/* Confidence */}
              {record.confidence < 0.5 && (
                <span className="text-[10px] text-amber-500">
                  {Math.round(record.confidence * 100)}% conf
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
