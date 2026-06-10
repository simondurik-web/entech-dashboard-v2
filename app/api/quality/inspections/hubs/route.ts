import { createInspection, updateRecord, HUB_UPDATABLE, actorName, actorRole, nullable } from "@/lib/quality/api"

const TABLE = "qa_hub_inspections"

export async function POST(req: Request) {
  return createInspection(req, TABLE, (body, actor) => ({
    timestamp: new Date().toISOString(),
    inspector_role: actorRole(actor),
    inspector_name: actorName(actor),
    hub_number: body.hub_number,
    hub_style: nullable(body.hub_style),
    hub_mold: nullable(body.hub_mold),
    mold_cavity: nullable(body.mold_cavity),
    bore_size: nullable(body.bore_size),
    bore_size_target: nullable(body.bore_size_target),
    bore_length: nullable(body.bore_length),
    bore_length_target: nullable(body.bore_length_target),
    hub_diameter: nullable(body.hub_diameter),
    hub_diameter_target: nullable(body.hub_diameter_target),
    weight: nullable(body.weight),
    weight_target: nullable(body.weight_target),
    locking_mechanism: body.locking_mechanism,
    visual_inspection: body.visual_inspection,
    comments: nullable(body.comments),
  }))
}

export async function PUT(req: Request) {
  return updateRecord(req, TABLE, HUB_UPDATABLE, { permission: "manage" })
}
