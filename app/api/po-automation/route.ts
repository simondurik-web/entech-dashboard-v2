import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import {
  EMPTY_STATUS_COUNTS,
  type PoAutomationResponse,
  type PoStatus,
  type ProcessedPo,
} from "@/lib/po-automation/types"

export const dynamic = "force-dynamic"
export const revalidate = 0

// GET /api/po-automation
// Returns the recent PO dedup queue plus summary stats for the monitoring page.
// Reads po_automation.processed_pos via the service-role client (bypasses RLS).
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .schema("po_automation")
      .from("processed_pos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)

    if (error) {
      console.error("[po-automation] Supabase query error:", error)
      return NextResponse.json(
        { error: "Failed to fetch PO automation queue", detail: error.message },
        { status: 502 }
      )
    }

    const records = (data ?? []) as ProcessedPo[]

    const by_status: Record<PoStatus, number> = { ...EMPTY_STATUS_COUNTS }
    const todayPrefix = new Date().toISOString().slice(0, 10)
    let entered_today = 0

    for (const r of records) {
      if (r.status in by_status) by_status[r.status] += 1
      if (r.status === "entered" && r.entered_at?.startsWith(todayPrefix)) {
        entered_today += 1
      }
    }

    const response: PoAutomationResponse = {
      stats: {
        total: records.length,
        by_status,
        entered_today,
        pending: by_status.pending + by_status.claimed + by_status.processing,
        failed: by_status.failed,
        duplicates_skipped: by_status.skipped_duplicate,
      },
      records,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error("[po-automation] Unexpected error:", err)
    return NextResponse.json(
      { error: "Unexpected error fetching PO automation queue" },
      { status: 500 }
    )
  }
}
