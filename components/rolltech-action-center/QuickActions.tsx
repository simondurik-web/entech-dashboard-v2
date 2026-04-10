"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { ActionRecord, QueueBucket } from "@/lib/rolltech-action-center/types"
import {
  MessageSquareWarning,
  HelpCircle,
  Clock,
  ClipboardCheck,
  CheckCircle2,
  VolumeX,
} from "lucide-react"

const QUICK_ACTIONS: { bucket: QueueBucket; label: string; icon: React.ReactNode; destructive?: boolean }[] = [
  { bucket: "needs_reply_today", label: "Reply needed", icon: <MessageSquareWarning className="size-3.5" /> },
  { bucket: "needs_internal_decision", label: "Waiting on internal", icon: <HelpCircle className="size-3.5" /> },
  { bucket: "waiting_on_customer", label: "Waiting on customer", icon: <Clock className="size-3.5" /> },
  { bucket: "ready_to_process", label: "Ready to process", icon: <ClipboardCheck className="size-3.5" /> },
  { bucket: "resolved", label: "Resolve", icon: <CheckCircle2 className="size-3.5" />, destructive: true },
  { bucket: "noise", label: "Mark noise", icon: <VolumeX className="size-3.5" />, destructive: true },
]

interface QuickActionsProps {
  record: ActionRecord
  onMutate?: (actionType: string) => void
  mutating?: boolean
  isDryRun?: boolean | null
}

export function QuickActions({ record, onMutate, mutating, isDryRun }: QuickActionsProps) {
  const [confirming, setConfirming] = useState<string | null>(null)

  function handleClick(bucket: string, destructive?: boolean) {
    if (destructive) {
      setConfirming(bucket)
    } else {
      onMutate?.(bucket)
    }
  }

  function handleConfirm() {
    if (confirming) {
      onMutate?.(confirming)
      setConfirming(null)
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Quick Actions
        </p>
        {(isDryRun === null || isDryRun) && (
          <span className="rounded-full border border-dashed border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            Dry run
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map(({ bucket, label, icon, destructive }) => {
          const isCurrent = record.queue_bucket === bucket

          return (
            <button
              key={bucket}
              type="button"
              disabled={isCurrent || mutating}
              onClick={() => !isCurrent && handleClick(bucket, destructive)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                isCurrent
                  ? "border-primary/40 bg-primary/10 text-primary ring-1 ring-primary/20 cursor-default"
                  : mutating
                    ? "border-border bg-background text-muted-foreground cursor-wait opacity-60"
                    : destructive
                      ? "border-border bg-background text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:hover:border-red-800 dark:hover:bg-red-900/20 dark:hover:text-red-400 cursor-pointer"
                      : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground cursor-pointer"
              )}
              title={isCurrent ? `Current status: ${label}` : `Move to: ${label}`}
            >
              {icon}
              {isCurrent ? (
                <>
                  <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                  {label}
                </>
              ) : label}
            </button>
          )
        })}
      </div>

      {/* Inline confirmation for destructive actions */}
      {confirming && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20">
          <p className="flex-1 text-xs text-red-700 dark:text-red-400">
            Move this thread to <strong>{QUICK_ACTIONS.find((a) => a.bucket === confirming)?.label ?? confirming}</strong>?
            {confirming === "noise" && " It will be hidden from the active queue."}
          </p>
          <button
            onClick={handleConfirm}
            disabled={mutating}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirming(null)}
            className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      )}

      {record.open_question && (
        <p className="text-[10px] text-muted-foreground/70 italic">
          Tip: resolve the open question before changing status.
        </p>
      )}
    </div>
  )
}
