"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { ActionRecord } from "@/lib/rolltech-action-center/types"
import { BUCKET_CONFIG, PRIORITY_CONFIG, SIGNAL_BADGES, getDisplayName } from "@/lib/rolltech-action-center/types"
import { QuickActions } from "./QuickActions"
import {
  Paperclip,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  AlertTriangle,
  Hash,
  X,
  ChevronsUpDown,
  Clock,
} from "lucide-react"

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

interface ActionDetailProps {
  record: ActionRecord
  onClose: () => void
  threadDetail?: ActionRecord | null
  threadDetailLoading?: boolean
  onMutate?: (actionType: string) => void
  mutating?: boolean
  isDryRun?: boolean | null
}

export function ActionDetail({
  record,
  onClose,
  threadDetail,
  threadDetailLoading,
  onMutate,
  mutating,
  isDryRun,
}: ActionDetailProps) {
  // Prefer fresh thread detail over queue snapshot when available
  const effective = threadDetail ?? record
  const [threadExpanded, setThreadExpanded] = useState(false)
  const bucket = BUCKET_CONFIG[effective.queue_bucket]
  const priority = PRIORITY_CONFIG[effective.priority] ?? PRIORITY_CONFIG["low"]
  const displayName = getDisplayName(effective)
  const allRefs = [
    ...effective.reference_numbers.po_numbers.map((p) => ({ type: "PO", value: p })),
    ...effective.reference_numbers.part_numbers.map((p) => ({ type: "Part", value: p })),
    ...effective.reference_numbers.quote_numbers.map((p) => ({ type: "Quote", value: p })),
    ...effective.reference_numbers.tracking_numbers.map((p) => ({ type: "Track", value: p })),
  ]

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{displayName}</h3>
          {/* Show original subject as subtitle only when displayName differs */}
          {displayName !== effective.thread_subject && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{effective.thread_subject}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 hover:bg-accent text-muted-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", priority.bg, priority.color)}>
          {priority.label}
        </span>
        <span className={cn("text-xs font-medium", bucket.color)}>{bucket.label}</span>
        {effective.thread_stage && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
            {effective.thread_stage.replace(/_/g, " ")}
          </span>
        )}
        {effective.owner_bucket && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize">
            {effective.owner_bucket}
          </span>
        )}
        <span className={cn(
          "ml-auto text-[10px] tabular-nums",
          effective.confidence < 0.5 ? "text-amber-500 font-medium" : "text-muted-foreground"
        )}>
          {Math.round(effective.confidence * 100)}%
        </span>
      </div>

      {/* Action summary */}
      <div className="rounded-md border bg-accent/30 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground mb-0.5">Next Action</p>
        <p className="text-sm">{effective.action_summary}</p>
      </div>

      {/* Stale warning */}
      {effective.stale_after_at && new Date(effective.stale_after_at) < new Date() && (
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800/30 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" />
          <span>Stale since {formatDate(effective.stale_after_at)} — may need re-triage</span>
        </div>
      )}

      {/* Due / risk */}
      {effective.due_at && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Due: {formatDate(effective.due_at)}
            </p>
            {effective.due_reason && (
              <p className="text-xs text-amber-600 dark:text-amber-500">{effective.due_reason}</p>
            )}
          </div>
        </div>
      )}

      {/* Open question */}
      {effective.open_question && (
        <div className="rounded-md border px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Open Question</p>
          <p className="text-xs text-foreground/80">{effective.open_question}</p>
        </div>
      )}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowDownLeft className="size-3 text-green-500" />
          <span>Last inbound: {formatDateTime(effective.last_inbound_at)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowUpRight className="size-3 text-blue-500" />
          <span>Last outbound: {formatDateTime(effective.last_outbound_at)}</span>
        </div>
        {effective.owner_hint && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground col-span-2">
            <Calendar className="size-3" />
            <span>Owner: {effective.owner_hint}</span>
          </div>
        )}
      </div>

      {/* Reference numbers */}
      {allRefs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">References</p>
          <div className="flex flex-wrap gap-1.5">
            {allRefs.map((ref, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-mono"
              >
                <Hash className="size-3 opacity-50" />
                {ref.type} {ref.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Signals */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Signals</p>
        <div className="flex flex-wrap gap-1">
          {effective.signals.map((sig) => {
            const badge = SIGNAL_BADGES[sig]
            return (
              <span
                key={sig}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  badge?.variant === "destructive"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {badge?.label ?? sig.replace(/_/g, " ")}
              </span>
            )
          })}
        </div>
      </div>

      {/* Attachments indicator */}
      {effective.has_attachments && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3" />
          <span>Thread has attachments</span>
        </div>
      )}

      {/* Latest messages — toggleable full-thread view */}
      {(effective.latest_inbound_snippet || effective.latest_outbound_snippet) && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-muted-foreground">Latest Context</p>
            <button
              onClick={() => setThreadExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronsUpDown className="size-3" />
              {threadExpanded ? "Collapse" : "Full thread"}
            </button>
          </div>
          <div className="space-y-2">
            {effective.latest_inbound_snippet && (
              <div className="rounded-md border-l-2 border-green-400 bg-green-50/50 px-3 py-2 dark:bg-green-900/10">
                <p className="text-[10px] font-medium text-green-600 dark:text-green-400 mb-0.5">Inbound</p>
                <p className={cn("text-xs text-foreground/70", !threadExpanded && "line-clamp-3")}>
                  {effective.latest_inbound_snippet}
                </p>
              </div>
            )}
            {effective.latest_outbound_snippet && (
              <div className="rounded-md border-l-2 border-blue-400 bg-blue-50/50 px-3 py-2 dark:bg-blue-900/10">
                <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">Outbound</p>
                <p className={cn("text-xs text-foreground/70", !threadExpanded && "line-clamp-3")}>
                  {effective.latest_outbound_snippet}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="border-t pt-3">
        <QuickActions record={effective} onMutate={onMutate} mutating={mutating} isDryRun={isDryRun} />
      </div>
    </div>
  )
}
