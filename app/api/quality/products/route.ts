import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { logQualityCreate, logQualityUpdate } from "@/lib/quality/audit"
import { actorName, errorJson, nullable, pickUpdates, PRODUCT_UPDATABLE, requireQualityActor } from "@/lib/quality/api"
import { normalizeProductType } from "@/lib/quality/metrics"

const TABLE = "qa_products"

export async function GET(req: NextRequest) {
  const gate = await requireQualityActor(req, "view")
  if ("response" in gate) return gate.response
  const type = normalizeProductType(req.nextUrl.searchParams.get("type"))
  let query = supabaseAdmin.from(TABLE).select("*").order("product_number")
  if (type) query = query.eq("product_type", type)
  const { data, error } = await query
  if (error) {
    console.error("products GET failed:", error)
    return errorJson("Failed to load products", 500)
  }
  return NextResponse.json({ data })
}

export async function POST(req: Request) {
  const gate = await requireQualityActor(req, "manage")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Record<string, unknown>
    const productType = normalizeProductType(body.product_type)
    const productNumber = typeof body.product_number === "string" ? body.product_number.trim() : ""
    if (!productType || !productNumber) return errorJson("product_type and product_number are required", 400)

    const payload = {
      product_type: productType,
      product_number: productNumber,
      description: nullable(body.description),
      hub_style: nullable(body.hub_style),
      hub_mold: nullable(body.hub_mold),
      bore_size_target: nullable(body.bore_size_target),
      bore_length_target: nullable(body.bore_length_target),
      hub_diameter_target: nullable(body.hub_diameter_target),
      weight_target: nullable(body.weight_target),
      thickness_target: nullable(body.thickness_target),
      diameter_target: nullable(body.diameter_target),
      specs_json: nullable(body.specs_json),
    }
    const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select().single()
    if (error) {
      // product_number has a global UNIQUE constraint — surface duplicates clearly.
      if (error.code === "23505") {
        return errorJson("A product with this number already exists", 409)
      }
      console.error("products POST failed:", error)
      return errorJson("Could not save product", 500)
    }
    await logQualityCreate(TABLE, data.id, data, actorName(gate.actor), gate.actor.email)
    return NextResponse.json({ data })
  } catch (err) {
    console.error("products POST exception:", err)
    return errorJson("Internal server error", 500)
  }
}

export async function PUT(req: Request) {
  const gate = await requireQualityActor(req, "manage")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Record<string, unknown>
    const id = body.id
    if (!id) return errorJson("Missing id", 400)
    const updates = pickUpdates(body, PRODUCT_UPDATABLE) // normalizes-or-drops product_type
    if (updates.product_number && typeof updates.product_number === "string") updates.product_number = updates.product_number.trim()
    if (Object.keys(updates).length === 0) return errorJson("No updatable fields supplied", 400)

    const { data: oldRecord } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).single()
    if (!oldRecord) return errorJson("Not found", 404)

    const { data, error } = await supabaseAdmin.from(TABLE).update(updates).eq("id", id).select().single()
    if (error) return errorJson(error.message, 500)
    await logQualityUpdate(TABLE, data.id, oldRecord, data, actorName(gate.actor), gate.actor.email)
    return NextResponse.json({ data })
  } catch (err) {
    console.error("products PUT exception:", err)
    return errorJson("Internal server error", 500)
  }
}
