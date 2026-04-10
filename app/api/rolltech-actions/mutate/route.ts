import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import type { QueueBucket } from "@/lib/rolltech-action-center/types"

export const dynamic = "force-dynamic"

const VALID_BUCKETS = new Set<QueueBucket>([
  "needs_reply_today",
  "needs_internal_decision",
  "ready_to_process",
  "shipping_release_coordination",
  "waiting_on_customer",
  "needs_review",
  "resolved",
  "noise",
])

interface MutatePayload {
  thread_key: string
  action_type: string
  performed_by?: string
  note?: string
}

export async function POST(req: NextRequest) {
  // Auth guard — require x-user-id header set by the session middleware/layout
  const userId = req.headers.get("x-user-id")
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  try {
    const body = (await req.json()) as Partial<MutatePayload>

    if (!body.thread_key || typeof body.thread_key !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid thread_key" },
        { status: 400 }
      )
    }

    if (!body.action_type || !VALID_BUCKETS.has(body.action_type as QueueBucket)) {
      return NextResponse.json(
        { error: "Invalid action_type", valid: [...VALID_BUCKETS] },
        { status: 400 }
      )
    }

    // Fetch the current bucket for audit trail
    const { data: current } = await supabaseAdmin
      .schema("work_email")
      .from("v_action_center_queue")
      .select("queue_bucket")
      .eq("thread_key", body.thread_key)
      .maybeSingle()

    // Insert the override
    const { error } = await supabaseAdmin
      .schema("work_email")
      .from("action_center_overrides")
      .insert({
        thread_key: body.thread_key,
        action_type: body.action_type,
        performed_by: body.performed_by ?? userId,
        previous_bucket: current?.queue_bucket ?? null,
        note: body.note ?? null,
      })

    if (error) {
      console.error("[rolltech-actions/mutate] insert error:", error)
      return NextResponse.json(
        { error: "Failed to write override", detail: error.message },
        { status: 500 }
      )
    }

    console.info(
      "[rolltech-actions/mutate] override written:",
      body.thread_key,
      current?.queue_bucket,
      "→",
      body.action_type
    )

    return NextResponse.json({
      ok: true,
      dry_run: false,
      thread_key: body.thread_key,
      action_type: body.action_type,
      previous_bucket: current?.queue_bucket ?? null,
    })
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    )
  }
}
