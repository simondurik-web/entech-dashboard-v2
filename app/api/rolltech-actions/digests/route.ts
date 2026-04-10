import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import type { DailyDigest, WeeklyDigest } from "@/lib/rolltech-action-center/types"

export const dynamic = "force-dynamic"
export const revalidate = 0

// v_action_center_daily_digest and v_action_center_weekly_digest are Phase 5+ views.
// This route attempts both queries and returns null gracefully when views don't exist yet.
export async function GET() {
  try {
    const [dailyResult, weeklyResult] = await Promise.allSettled([
      supabaseAdmin
        .schema("work_email")
        .from("v_action_center_daily_digest")
        .select("*")
        .order("digest_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .schema("work_email")
        .from("v_action_center_weekly_digest")
        .select("*")
        .order("week_ending", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const daily: DailyDigest | null =
      dailyResult.status === "fulfilled" && !dailyResult.value.error && dailyResult.value.data
        ? (dailyResult.value.data as unknown as DailyDigest)
        : null

    const weekly: WeeklyDigest | null =
      weeklyResult.status === "fulfilled" && !weeklyResult.value.error && weeklyResult.value.data
        ? (weeklyResult.value.data as unknown as WeeklyDigest)
        : null

    if (
      dailyResult.status === "rejected" ||
      (dailyResult.status === "fulfilled" && dailyResult.value.error)
    ) {
      console.info(
        "[rolltech-actions/digests] daily_digest not available:",
        dailyResult.status === "rejected"
          ? dailyResult.reason
          : dailyResult.value.error?.message
      )
    }
    if (
      weeklyResult.status === "rejected" ||
      (weeklyResult.status === "fulfilled" && weeklyResult.value.error)
    ) {
      console.info(
        "[rolltech-actions/digests] weekly_digest not available:",
        weeklyResult.status === "rejected"
          ? weeklyResult.reason
          : weeklyResult.value.error?.message
      )
    }

    return NextResponse.json(
      { daily_digest: daily, weekly_digest: weekly },
      {
        headers: {
          "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
        },
      }
    )
  } catch (err) {
    console.error("[rolltech-actions/digests] Unexpected error:", err)
    return NextResponse.json({ daily_digest: null, weekly_digest: null })
  }
}
