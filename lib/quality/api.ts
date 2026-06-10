import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { logQualityCreate, logQualityUpdate } from "@/lib/quality/audit"
import { qualityActorFromRequest, type QualityActor } from "@/lib/quality/guard"
import { normalizeProductType, type ProductType } from "@/lib/quality/metrics"

type Mutable = Record<string, unknown>

export const HUB_UPDATABLE = new Set([
  "hub_number", "hub_style", "hub_mold", "mold_cavity",
  "bore_size", "bore_size_target", "bore_length", "bore_length_target",
  "hub_diameter", "hub_diameter_target", "weight", "weight_target",
  "locking_mechanism", "visual_inspection", "comments",
])

export const TIRE_UPDATABLE = new Set([
  "tire_number",
  "thickness", "thickness_target",
  "diameter", "diameter_target",
  "weight", "weight_target",
  "visual_inspection", "comments",
])

export const FINISHED_UPDATABLE = new Set([
  "rt_number", "correct_tire", "correct_hub", "correct_hub_color",
  "tire_od", "tire_thickness", "tire_weight",
  "bore_check", "locking_mechanism", "tire_visual", "hub_visual",
  "comments",
])

export const NCR_UPDATABLE = new Set([
  "product_type", "product_number", "hub_style", "hub_mold", "mold_cavity",
  "defect_type", "defect_description", "quantity_affected",
  "disposition", "root_cause", "corrective_action", "preventive_action",
  "status", "photos",
  // NOTE: closed_at / closed_by / updated_at are intentionally NOT whitelisted —
  // they are server-controlled and set only by the NCR route's beforeUpdate hook,
  // so a client cannot forge who/when an NCR was closed.
])

export const PRODUCT_UPDATABLE = new Set([
  "product_type", "product_number", "description", "hub_style", "hub_mold",
  "bore_size_target", "bore_length_target", "hub_diameter_target", "weight_target",
  "thickness_target", "diameter_target", "specs_json",
])

export function errorJson(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function requireQualityActor(
  req: Request,
  permission: "view" | "manage" | "limits",
): Promise<{ actor: QualityActor } | { response: NextResponse }> {
  const actor = await qualityActorFromRequest(req)
  const allowed =
    permission === "view" ? actor.canView :
    permission === "manage" ? actor.canManage :
    actor.canEditLimits

  if (!allowed) return { response: errorJson("Forbidden", 403) }
  return { actor }
}

export function actorName(actor: QualityActor): string {
  return actor.name || actor.email || "Unknown"
}

export function actorRole(actor: QualityActor): string {
  return actor.qualityRole || actor.dashboardRole || "visitor"
}

export function nullable(value: unknown): unknown {
  return value === "" || value === undefined ? null : value
}

export function pickUpdates(body: Mutable, whitelist: Set<string>): Mutable {
  const updates: Mutable = {}
  for (const [key, value] of Object.entries(body)) {
    if (!whitelist.has(key)) continue
    if (key === "product_type") {
      // Reject (skip) an unrecognized product_type instead of nulling the column.
      const pt = normalizeProductType(value)
      if (pt) updates[key] = pt
      continue
    }
    updates[key] = value
  }
  return updates
}

export async function createInspection(
  req: Request,
  table: string,
  buildPayload: (body: Mutable, actor: QualityActor) => Mutable,
) {
  const gate = await requireQualityActor(req, "view")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Mutable
    const payload = buildPayload(body, gate.actor)
    const { data, error } = await supabaseAdmin.from(table).insert(payload).select().single()
    if (error) {
      console.error(`${table} POST failed:`, error)
      return errorJson("Could not save inspection", 500)
    }
    await logQualityCreate(table, data.id, data, actorName(gate.actor), gate.actor.email)
    return NextResponse.json({ data })
  } catch (err) {
    console.error(`${table} POST exception:`, err)
    return errorJson("Internal server error", 500)
  }
}

export async function updateRecord(
  req: Request,
  table: string,
  whitelist: Set<string>,
  options?: {
    permission?: "view" | "manage" | "limits"
    beforeUpdate?: (updates: Mutable, oldRecord: Mutable, actor: QualityActor) => void
    noFieldsMessage?: string
  },
) {
  const gate = await requireQualityActor(req, options?.permission ?? "view")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Mutable
    const { id, ...rest } = body
    if (!id) return errorJson("Missing id", 400)

    const updates = pickUpdates(rest, whitelist)
    if (Object.keys(updates).length === 0) {
      return errorJson(options?.noFieldsMessage ?? "No updatable fields supplied", 400)
    }

    const { data: oldRecord, error: oldError } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .single()
    if (oldError || !oldRecord) return errorJson("Not found", 404)

    options?.beforeUpdate?.(updates, oldRecord, gate.actor)

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(updates)
      .eq("id", id)
      .select()
      .single()
    if (error) {
      console.error(`${table} PUT failed:`, error)
      return errorJson("Could not save changes", 500)
    }

    await logQualityUpdate(table, data.id, oldRecord, data, actorName(gate.actor), gate.actor.email)
    return NextResponse.json({ data })
  } catch (err) {
    console.error(`${table} PUT exception:`, err)
    return errorJson("Internal server error", 500)
  }
}

export function validProductType(value: unknown): value is ProductType {
  return normalizeProductType(value) !== null
}
