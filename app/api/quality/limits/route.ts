import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { errorJson, requireQualityActor } from "@/lib/quality/api"
import { normalizeProductType, type LimitRow } from "@/lib/quality/metrics"

type ChangeInput = {
  metric_key: string
  min: number | null
  target: number | null
  max: number | null
}

function changed(oldV: number | null | undefined, newV: number | null | undefined): boolean {
  return (oldV ?? null) !== (newV ?? null)
}

function validNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

export async function GET() {
  const { data: limits, error: lErr } = await supabaseAdmin
    .from("qa_product_limits")
    .select("*")
    .order("product_type")
    .order("product_number")
    .order("metric_key")
  if (lErr) return errorJson(lErr.message, 500)

  const { data: products, error: pErr } = await supabaseAdmin
    .from("qa_products")
    .select("product_type, product_number, description")
    .order("product_type")
    .order("product_number")
  if (pErr) return errorJson(pErr.message, 500)

  return NextResponse.json({ limits: limits || [], products: products || [] })
}

export async function PATCH(req: Request) {
  const gate = await requireQualityActor(req, "limits")
  if ("response" in gate) return gate.response

  let body: {
    product_type?: unknown
    product_number?: unknown
    changes?: unknown
    reason?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return errorJson("Invalid JSON body", 400)
  }

  const productType = normalizeProductType(body.product_type)
  const productNumber = typeof body.product_number === "string" ? body.product_number.trim() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!productType || !productNumber) return errorJson("product_type and product_number are required", 400)
  if (!Array.isArray(body.changes) || body.changes.length === 0) return errorJson("changes array required", 400)
  if (!reason) return errorJson("reason is required", 400)

  const changes = body.changes as ChangeInput[]
  for (const c of changes) {
    if (!c.metric_key) return errorJson("each change must have metric_key", 400)
    if (!validNumber(c.min) || !validNumber(c.target) || !validNumber(c.max)) {
      return errorJson(`invalid numeric value for ${c.metric_key}`, 400)
    }
    if (c.min !== null && c.max !== null && c.min > c.max) return errorJson(`min > max for ${c.metric_key}`, 400)
    if (c.min !== null && c.target !== null && c.target < c.min) return errorJson(`target < min for ${c.metric_key}`, 400)
    if (c.target !== null && c.max !== null && c.target > c.max) return errorJson(`target > max for ${c.metric_key}`, 400)
  }

  const metricKeys = changes.map((c) => c.metric_key)
  const { data: currentRows, error: cErr } = await supabaseAdmin
    .from("qa_product_limits")
    .select("*")
    .eq("product_type", productType)
    .eq("product_number", productNumber)
    .in("metric_key", metricKeys)
  if (cErr) return errorJson(cErr.message, 500)

  const currentByMetric = new Map<string, LimitRow>()
  for (const row of currentRows || []) currentByMetric.set(row.metric_key, row as LimitRow)

  const now = new Date().toISOString()
  const limitsToUpsert: Record<string, unknown>[] = []
  const historyRows: Record<string, unknown>[] = []
  for (const c of changes) {
    const old = currentByMetric.get(c.metric_key)
    const oldMin = old?.min_value ?? null
    const oldTarget = old?.target_value ?? null
    const oldMax = old?.max_value ?? null
    const isChanged = changed(oldMin, c.min) || changed(oldTarget, c.target) || changed(oldMax, c.max)
    if (!isChanged) continue

    limitsToUpsert.push({
      product_type: productType,
      product_number: productNumber,
      metric_key: c.metric_key,
      min_value: c.min,
      target_value: c.target,
      max_value: c.max,
      updated_by: gate.actor.userId,
      updated_at: now,
    })
    historyRows.push({
      product_type: productType,
      product_number: productNumber,
      metric_key: c.metric_key,
      old_min: oldMin,
      old_target: oldTarget,
      old_max: oldMax,
      new_min: c.min,
      new_target: c.target,
      new_max: c.max,
      changed_by: gate.actor.userId,
      change_reason: reason,
    })
  }

  if (limitsToUpsert.length === 0) {
    return NextResponse.json({ updated: 0, history_rows: 0, message: "no values changed" })
  }

  const { error: upErr } = await supabaseAdmin
    .from("qa_product_limits")
    .upsert(limitsToUpsert, { onConflict: "product_type,product_number,metric_key" })
  if (upErr) return errorJson(`upsert failed: ${upErr.message}`, 500)

  const { error: hErr } = await supabaseAdmin.from("qa_product_limit_history").insert(historyRows)
  if (hErr) {
    return NextResponse.json({
      error: `WARNING: limits updated but history insert failed: ${hErr.message}`,
      updated: limitsToUpsert.length,
      history_rows: 0,
    }, { status: 500 })
  }

  return NextResponse.json({ updated: limitsToUpsert.length, history_rows: historyRows.length })
}
