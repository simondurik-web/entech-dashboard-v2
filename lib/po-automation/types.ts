// Shared types for the PO Automation monitoring view.
// Backed by the `po_automation.processed_pos` dedup table in the shared Supabase
// project (mqfjmzqeccufqhisqpij). Both the new hybrid automation (Claude
// orchestrator + codex FileMaker driver) and Phil's existing backup automation
// write here so the same PO is never entered into FileMaker twice.

export type PoStatus =
  | "pending"
  | "claimed"
  | "processing"
  | "entered"
  | "failed"
  | "skipped_duplicate"
  | "manual_override"

export type PoEnteredVia = "data_api" | "codex_ui" | "phil_backup" | "manual"

export type PoPartyType = "customer" | "vendor" | "unknown"

export interface ProcessedPo extends Record<string, unknown> {
  id: string
  po_number: string | null
  party: string | null
  party_type: PoPartyType
  source_message_id: string | null
  source_inbox: string | null
  content_hash: string
  status: PoStatus
  entered_via: PoEnteredVia | null
  filemaker_record_id: string | null
  claimed_by: string | null
  claimed_at: string | null
  lease_expires_at: string | null
  attempts: number
  payload: Record<string, unknown> | null
  error: string | null
  created_at: string
  updated_at: string
  entered_at: string | null
  /** Sales order number(s) the PO was entered against in FileMaker. */
  so_numbers: string | null
  /** Public URLs of the Codex proof screenshots captured during entry. */
  screenshot_urls: string[] | null
  /** Public URL of the customer's original PO PDF, if attached. */
  po_pdf_url: string | null
}

export interface PoAutomationStats {
  total: number
  by_status: Record<PoStatus, number>
  entered_today: number
  pending: number
  failed: number
  duplicates_skipped: number
}

export interface PoAutomationResponse {
  stats: PoAutomationStats
  records: ProcessedPo[]
}

export const EMPTY_STATUS_COUNTS: Record<PoStatus, number> = {
  pending: 0,
  claimed: 0,
  processing: 0,
  entered: 0,
  failed: 0,
  skipped_duplicate: 0,
  manual_override: 0,
}
