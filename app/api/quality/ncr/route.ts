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

// IMPORTANT schema quirk (verified against the live DB CHECK constraints):
// qa_products.product_type allows 'finished_product', but
// qa_nonconformance_reports.product_type allows 'finished'. The standalone
// EQDR app stores 'finished' in NCR rows. So we normalize incoming values for
// validation/product lookups, then map back to the NCR table's vocabulary.
function toNcrProductType(pt: string): string {
  return pt === "finished_product" ? "finished" : pt
}

export async function POST(req: Request) {
  const gate = await requireQualityActor(req, "view")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Record<string, unknown>
    const productType = normalizeProductType(body.product_type)
    if (!productType) return errorJson("product_type must be hub | tire | finished_product", 400)

    const qtyRaw = body.quantity_affected
    const qty = qtyRaw === undefined || qtyRaw === null || qtyRaw === "" ? 1 : Number(qtyRaw)
    if (!Number.isInteger(qty) || qty < 1) {
      return errorJson("quantity_affected must be a positive integer", 400)
    }

    const { data: n, error: nErr } = await supabaseAdmin.rpc("qa_next_ncr_number")
    if (nErr || typeof n !== "string" || !n) {
      console.error("qa_next_ncr_number failed:", nErr)
      return errorJson("Could not generate NCR number", 500)
    }

    const payload = {
      ncr_number: n,
      reported_by: actorName(gate.actor),
      reported_by_email: gate.actor.email,
      product_type: toNcrProductType(productType),
      product_number: nullable(body.product_number),
      hub_style: nullable(body.hub_style),
      hub_mold: nullable(body.hub_mold),
      mold_cavity: nullable(body.mold_cavity),
      source_inspection_id: nullable(body.source_inspection_id),
      source_inspection_table: nullable(body.source_inspection_table),
      defect_type: body.defect_type,
      defect_description: body.defect_description,
      quantity_affected: qty,
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

const VALID_NCR_STATUS = new Set(["OPEN", "INVESTIGATING", "CLOSED"])

export async function PUT(req: Request) {
  return updateRecord(req, TABLE, NCR_UPDATABLE, {
    permission: "manage",
    beforeUpdate(updates, oldRecord, actor) {
      if (updates.product_type) {
        // pickUpdates already normalized; map to the NCR table's vocabulary
        // ('finished', not 'finished_product') or drop if invalid.
        const pt = normalizeProductType(updates.product_type)
        if (pt) updates.product_type = toNcrProductType(pt)
        else delete updates.product_type
      }
      // Ignore an unrecognized status rather than writing garbage.
      if (updates.status !== undefined && !VALID_NCR_STATUS.has(String(updates.status))) {
        delete updates.status
      }
      if (updates.status === "CLOSED" && oldRecord.status !== "CLOSED") {
        updates.closed_at = new Date().toISOString()
        updates.closed_by = actorName(actor)
      }
      updates.updated_at = new Date().toISOString()
    },
  })
}
