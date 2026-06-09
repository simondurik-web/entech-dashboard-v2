import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { logQualityCreate } from "@/lib/quality/audit"
import {
  actorName,
  errorJson,
  NCR_UPDATABLE,
  nullable,
  requireQualityActor,
  updateRecord,
} from "@/lib/quality/api"
import { normalizeProductType } from "@/lib/quality/metrics"

const TABLE = "qa_nonconformance_reports"

export async function POST(req: Request) {
  const gate = await requireQualityActor(req, "view")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Record<string, unknown>
    const productType = normalizeProductType(body.product_type)
    if (!productType) return errorJson("product_type must be hub | tire | finished_product", 400)

    const { data: n, error: nErr } = await supabaseAdmin.rpc("qa_next_ncr_number")
    if (nErr || typeof n !== "string" || !n) {
      console.error("qa_next_ncr_number failed:", nErr)
      return errorJson("Could not generate NCR number", 500)
    }

    const payload = {
      ncr_number: n,
      reported_by: actorName(gate.actor),
      reported_by_email: gate.actor.email,
      product_type: productType,
      product_number: nullable(body.product_number),
      hub_style: nullable(body.hub_style),
      hub_mold: nullable(body.hub_mold),
      mold_cavity: nullable(body.mold_cavity),
      source_inspection_id: nullable(body.source_inspection_id),
      source_inspection_table: nullable(body.source_inspection_table),
      defect_type: body.defect_type,
      defect_description: body.defect_description,
      quantity_affected: body.quantity_affected || 1,
      disposition: body.disposition || "HOLD",
      root_cause: nullable(body.root_cause),
      corrective_action: nullable(body.corrective_action),
      preventive_action: nullable(body.preventive_action),
      status: "OPEN",
      photos: body.photos || [],
    }

    const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select().single()
    if (error) {
      console.error("ncr POST insert failed:", error)
      return errorJson("Could not save NCR", 500)
    }
    await logQualityCreate(TABLE, data.id, data, actorName(gate.actor), gate.actor.email)
    return NextResponse.json({ data })
  } catch (err) {
    console.error("ncr POST exception:", err)
    return errorJson("Internal server error", 500)
  }
}

export async function PUT(req: Request) {
  return updateRecord(req, TABLE, NCR_UPDATABLE, {
    beforeUpdate(updates, oldRecord, actor) {
      if (updates.product_type) updates.product_type = normalizeProductType(updates.product_type)
      if (updates.status === "CLOSED" && oldRecord.status !== "CLOSED") {
        updates.closed_at = new Date().toISOString()
        updates.closed_by = actorName(actor)
      }
      updates.updated_at = new Date().toISOString()
    },
  })
}
