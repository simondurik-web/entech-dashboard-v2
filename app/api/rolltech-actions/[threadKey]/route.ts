import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import type { ActionRecord } from "@/lib/rolltech-action-center/types"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadKey: string }> }
) {
  const { threadKey: rawKey } = await params
  const threadKey = decodeURIComponent(rawKey)

  try {
    const { data, error } = await supabaseAdmin
      .schema("work_email")
      .from("v_action_center_queue")
      .select("*")
      .eq("thread_key", threadKey)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ record: null }, { status: 404 })
      }
      console.error("[rolltech-actions/thread] Supabase error:", error)
      return NextResponse.json(
        { error: "Failed to fetch thread detail", detail: error.message },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { record: data as ActionRecord },
      {
        headers: {
          "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
        },
      }
    )
  } catch (err) {
    console.error("[rolltech-actions/thread] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
