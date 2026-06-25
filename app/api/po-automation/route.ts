import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { canAccessPoAutomation } from "@/lib/po-automation/guard"
import {
  EMPTY_STATUS_COUNTS,
  type PoAutomationResponse,
  type PoStatus,
  type ProcessedPo,
} from "@/lib/po-automation/types"
import { escapeLike } from "@/lib/po-automation/edit"
import { requireUser } from "@/lib/require-user"

export const dynamic = "force-dynamic"
export const revalidate = 0

/** Single-record lookup payload used by the order-detail "PO & Fusion Entry" section. */
export interface PoLookupResponse {
  match: {
    po_pdf_url: string | null
    screenshot_urls: string[] | null
    so_numbers: string | null
    status: PoStatus
    party: string | null
    po_number: string | null
  } | null
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

// GET /api/po-automation
// Default: returns the recent PO dedup queue plus summary stats for the
//   monitoring page.
// With ?customer=<name>&po=<number>: returns the single best-matching record
//   (case-insensitive, trimmed) for the order-detail "PO & Fusion Entry" panel.
// Reads po_automation.processed_pos via the service-role client (bypasses RLS).
export async function GET(req: NextRequest) {
  // Server-side permission gate — the service-role query below bypasses RLS, so
  // the client-side AccessGuard / canAccess() gate is not sufficient on its own.
  const userId = (await requireUser(req))?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!(await canAccessPoAutomation(userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const customer = searchParams.get("customer")
  const po = searchParams.get("po")

  // Single-record lookup mode for the order detail expansion.
  if (customer || po) {
    return lookupSingle(customer, po)
  }

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
        pending:
          by_status.pending +
          by_status.claimed +
          by_status.processing +
          by_status.pending_confirmation +
          by_status.revision_pending +
          by_status.revision_pending_confirmation +
          by_status.manual_correction_flagged,
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

/**
 * Find the single best PO automation record for a given customer + PO number.
 * Matches `party` ≈ customer (case-insensitive, trimmed) AND `po_number` = po.
 * Returns { match: null } when nothing matches so the UI can show "no record".
 */
async function lookupSingle(
  customer: string | null,
  po: string | null
): Promise<NextResponse<PoLookupResponse>> {
  const empty: PoLookupResponse = { match: null }

  // Require both a customer and a PO number to avoid leaking unrelated records.
  if (!customer?.trim() || !po?.trim()) {
    return NextResponse.json(empty)
  }

  try {
    // Narrow on po_number in the query (exact, case-insensitive), then refine
    // the party match in JS since `party` casing/whitespace varies upstream.
    const { data, error } = await supabaseAdmin
      .schema("po_automation")
      .from("processed_pos")
      .select("po_pdf_url, screenshot_urls, so_numbers, status, party, po_number")
      .ilike("po_number", escapeLike(po.trim()))
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      console.error("[po-automation] lookup query error:", error)
      return NextResponse.json(empty)
    }

    const rows = (data ?? []) as PoLookupResponse["match"][]
    const wantCustomer = norm(customer)
    const wantPo = norm(po)

    // Prefer an exact party match; fall back to a substring match either way.
    const exact = rows.find(
      (r) => norm(r?.party) === wantCustomer && norm(r?.po_number) === wantPo
    )
    const fuzzy = rows.find((r) => {
      const p = norm(r?.party)
      return (
        norm(r?.po_number) === wantPo &&
        (p.includes(wantCustomer) || wantCustomer.includes(p)) &&
        p.length > 0
      )
    })

    return NextResponse.json({ match: exact ?? fuzzy ?? null })
  } catch (err) {
    console.error("[po-automation] lookup unexpected error:", err)
    return NextResponse.json(empty)
  }
}
