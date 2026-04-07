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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Quick Actions
        </p>
        <span className="rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Read-only preview
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
                "inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium opacity-80",
                isCurrent
                  ? "border-primary/30 bg-primary/5 text-primary cursor-default"
                  : "border-border bg-muted/40 text-muted-foreground"
              )}
              title="Preview only. No write path is wired in this pass."
            >
              {icon}
              {isCurrent ? `Current: ${label}` : label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
