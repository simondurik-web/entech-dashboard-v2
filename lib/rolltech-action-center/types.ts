export type ActionStatus =
  | "needs_internal_action"
  | "waiting_on_customer"
  | "resolved"
  | "no_action_reference"
  | "needs_review"

export type ActionPriority = "high" | "medium" | "low"

export type QueueBucket =
  | "needs_reply_today"
  | "needs_internal_decision"
  | "ready_to_process"
  | "shipping_release_coordination"
  | "waiting_on_customer"
  | "resolved"
  | "noise"
  | "needs_review"

export type OwnerBucket = "sales" | "customer_service" | "shipping" | "operations" | "unknown" | null

export type ThreadStage =
  | "rfq"
  | "quote_sent"
  | "po_received"
  | "sample_flow"
  | "shipping"
  | "post_sale_issue"
  | "reference"
  | null

export type MeaningfulDirection =
  | "inbound_customer"
  | "outbound_rolltech"
  | "system"
  | "mixed"
  | "unknown"

export interface ReferenceNumbers {
  po_numbers: string[]
  quote_numbers: string[]
  part_numbers: string[]
  tracking_numbers: string[]
}

export interface ActionRecord {
  action_record_id: string
  thread_key: string
  thread_subject: string
  subject_normalized: string
  status: ActionStatus
  priority: ActionPriority
  action_needed: boolean
  queue_bucket: QueueBucket
  owner_hint: string | null
  owner_bucket: OwnerBucket
  customer_name: string | null
  action_summary: string
  last_meaningful_direction: MeaningfulDirection
  last_meaningful_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  due_at: string | null
  due_reason: string | null
  stale_after_at: string | null
  confidence: number
  signals: string[]
  open_question: string | null
  latest_inbound_snippet: string | null
  latest_outbound_snippet: string | null
  thread_stage: ThreadStage
  reference_numbers: ReferenceNumbers
  has_attachments: boolean
  is_noise_suppressed: boolean
}

export interface DigestItem {
  subject: string
  summary: string
  priority: string
  reference: string | null
  owner_hint: string | null
  thread_key: string
  due_reason?: string | null
  open_question?: string | null
  has_attachments: boolean
  confidence: number
  signals: string[]
  status?: string
  queue_bucket?: string
  risk_reasons?: string[]
}

export interface DigestSection {
  title: string
  count: number
  items: DigestItem[]
}

export interface DailyDigest {
  digest_type: "daily"
  digest_version: string
  digest_date: string
  generated_at: string
  total_active: number
  total_suppressed: number
  total_items_surfaced: number
  sections: DigestSection[]
}

export interface WeeklyDigest {
  digest_type: "weekly"
  digest_version: string
  week_ending: string
  generated_at: string
  total_records: number
  total_active: number
  total_suppressed: number
  open_commitments: {
    total: number
    buckets: Record<string, DigestItem[]>
  }
  at_risk: {
    count: number
    items: DigestItem[]
  }
  new_business: {
    rfq_threads: DigestItem[]
    order_threads: DigestItem[]
    active_accounts: string[]
    total_new_business: number
  }
  throughput: {
    resolved_count: number
    active_count: number
    newly_resolved_count: number | null
    new_thread_count: number | null
    resolved_threads: DigestItem[]
    newly_resolved_threads: DigestItem[]
  }
  noise_report: {
    total_suppressed: number
    noise_count: number
    resolved_count: number
    suppression_rate: number
    noise_threads: DigestItem[]
    resolved_threads: DigestItem[]
  }
}

export const BUCKET_CONFIG: Record<
  QueueBucket,
  { label: string; shortLabel: string; color: string; order: number }
> = {
  needs_reply_today: { label: "Needs Reply Today", shortLabel: "Reply Today", color: "text-red-500", order: 0 },
  needs_internal_decision: { label: "Needs Internal Decision", shortLabel: "Internal", color: "text-orange-500", order: 1 },
  ready_to_process: { label: "Ready to Process", shortLabel: "Process", color: "text-blue-500", order: 2 },
  shipping_release_coordination: { label: "Shipping / Release", shortLabel: "Shipping", color: "text-cyan-500", order: 3 },
  waiting_on_customer: { label: "Waiting on Customer", shortLabel: "Wait Cust", color: "text-yellow-500", order: 4 },
  needs_review: { label: "Needs Review", shortLabel: "Review", color: "text-purple-500", order: 5 },
  resolved: { label: "Resolved", shortLabel: "Resolved", color: "text-green-500", order: 6 },
  noise: { label: "Noise / Ignore", shortLabel: "Noise", color: "text-gray-400", order: 7 },
}

export const PRIORITY_CONFIG: Record<ActionPriority, { label: string; color: string; bg: string }> = {
  high: { label: "High", color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
  medium: { label: "Medium", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" },
  low: { label: "Low", color: "text-gray-500 dark:text-gray-400", bg: "bg-gray-100 dark:bg-gray-800" },
}

/**
 * Derive a short display name for an action record.
 * Prefers customer_name when available; otherwise falls back to a cleaned
 * version of thread_subject (strips Re/Fwd prefixes, trims common noise).
 */
export function getDisplayName(record: Pick<ActionRecord, "customer_name" | "thread_subject">): string {
  if (record.customer_name) return record.customer_name

  let name = record.thread_subject
  // Strip Re:/Fwd:/FW: chains
  name = name.replace(/^(?:(?:re|fwd?)\s*:\s*)+/i, "").trim()
  // If subject starts with a recognizable "Company - ..." or "Company:" pattern, use just the company part
  const dashMatch = name.match(/^([^-–—]+?)\s*[-–—]\s+/)
  if (dashMatch && dashMatch[1].length >= 3 && dashMatch[1].length <= 60) {
    return dashMatch[1].trim()
  }
  // Truncate long subjects
  if (name.length > 50) name = name.slice(0, 47) + "…"
  return name || "Unknown Thread"
}

// Spec mapping: 'Waiting on RollTech / Production' → needs_internal_decision bucket
// These threads require an internal decision or action from the RollTech/Production team
// before they can progress. The queue_bucket value "needs_internal_decision" covers this case.

export const SIGNAL_BADGES: Record<string, { label: string; variant: "default" | "destructive" | "outline" }> = {
  pricing_request: { label: "RFQ", variant: "outline" },
  po_received: { label: "PO", variant: "default" },
  po_number_present: { label: "PO#", variant: "outline" },
  shipping_signal: { label: "Ship", variant: "outline" },
  attachment_present: { label: "Attach", variant: "outline" },
  urgency: { label: "Urgent", variant: "destructive" },
  undeliverable: { label: "Bounce", variant: "destructive" },
  complaint_quality: { label: "Issue", variant: "destructive" },
  follow_up: { label: "Follow-up", variant: "outline" },
  sample_request: { label: "Sample", variant: "outline" },
  lead_time_request: { label: "Lead Time", variant: "outline" },
}
