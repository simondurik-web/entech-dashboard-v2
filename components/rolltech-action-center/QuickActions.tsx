"use client"

import { cn } from "@/lib/utils"
import type { ActionRecord, QueueBucket } from "@/lib/rolltech-action-center/types"
import {
  MessageSquareWarning,
  HelpCircle,
  Clock,
  ClipboardCheck,
  CheckCircle2,
} from "lucide-react"

const QUICK_ACTIONS: { bucket: QueueBucket; label: string; icon: React.ReactNode }[] = [
  { bucket: "needs_reply_today", label: "Reply needed", icon: <MessageSquareWarning className="size-3.5" /> },
  { bucket: "needs_internal_decision", label: "Waiting on internal", icon: <HelpCircle className="size-3.5" /> },
  { bucket: "waiting_on_customer", label: "Waiting on customer", icon: <Clock className="size-3.5" /> },
  { bucket: "ready_to_process", label: "Ready to process", icon: <ClipboardCheck className="size-3.5" /> },
  { bucket: "resolved", label: "Resolve", icon: <CheckCircle2 className="size-3.5" /> },
]

interface QuickActionsProps {
  record: ActionRecord
}

export function QuickActions({ record }: QuickActionsProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Quick Actions
        </p>
        <span className="rounded-full border border-dashed border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          Preview only
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map(({ bucket, label, icon }) => {
          const isCurrent = record.queue_bucket === bucket

          return (
            <button
              key={bucket}
              type="button"
              disabled
              aria-disabled="true"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                isCurrent
                  ? "border-primary/40 bg-primary/10 text-primary ring-1 ring-primary/20 cursor-default"
                  : "border-border bg-background text-muted-foreground cursor-not-allowed opacity-60"
              )}
              title={isCurrent ? `Current status: ${label}` : "Preview only — write path not wired yet"}
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
      {record.open_question && (
        <p className="text-[10px] text-muted-foreground/70 italic">
          Tip: resolve the open question before changing status.
        </p>
      )}
    </div>
  )
}
