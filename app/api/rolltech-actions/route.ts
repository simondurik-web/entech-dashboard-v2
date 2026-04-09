import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import type {
  ActionRecord,
  QueueBucket,
  DailyDigest,
  WeeklyDigest,
} from "@/lib/rolltech-action-center/types"

export const dynamic = "force-dynamic"
export const revalidate = 0

interface ActionCenterResponse {
  records: ActionRecord[]
  bucket_counts: Record<QueueBucket, number>
  daily_digest: DailyDigest | null
  weekly_digest: WeeklyDigest | null
}

const EMPTY_BUCKET_COUNTS: Record<QueueBucket, number> = {
  needs_reply_today: 0,
  needs_internal_decision: 0,
  ready_to_process: 0,
  shipping_release_coordination: 0,
  waiting_on_customer: 0,
  needs_review: 0,
  resolved: 0,
  noise: 0,
}

export async function GET() {
  try {
    // Fetch all action records from the live view
    // The view uses effective_priority / effective_status columns;
    // we remap them to priority / status to match ActionRecord type.
    const { data: rawRecords, error } = await supabaseAdmin
      .schema("work_email")
      .from("v_action_center_queue")
      .select("*")

    if (error) {
      console.error("[rolltech-actions] Supabase query error:", error)
      return NextResponse.json(
        { error: "Failed to fetch action center records", detail: error.message },
        { status: 502 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = (rawRecords ?? []).map((r: any) => ({
      ...r,
      priority: (r.effective_priority ?? r.machine_priority ?? r.priority ?? "low") as string,
      status: (r.effective_status ?? r.machine_status ?? r.status ?? "open") as string,
    }))


    // Compute bucket counts from live data
    const bucketCounts = { ...EMPTY_BUCKET_COUNTS }
    for (const r of records ?? []) {
      const bucket = r.queue_bucket as QueueBucket
      if (bucket in bucketCounts) {
        bucketCounts[bucket]++
      }
    }

    const response: ActionCenterResponse = {
      records: records as ActionRecord[],
      bucket_counts: bucketCounts,
      // Digests are not yet available in Supabase views — placeholder nulls.
      // Phase 5+ will wire v_action_center_daily_digest / weekly_digest views.
      daily_digest: null,
      weekly_digest: null,
    }

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    })
  } catch (err) {
    console.error("[rolltech-actions] Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
