import { createInspection, updateRecord, TIRE_UPDATABLE, actorName, actorRole, nullable } from "@/lib/quality/api"

const TABLE = "qa_tire_inspections"

export async function POST(req: Request) {
  return createInspection(req, TABLE, (body, actor) => ({
    timestamp: new Date().toISOString(),
    inspector_role: actorRole(actor),
    inspector_name: actorName(actor),
    tire_number: body.tire_number,
    thickness: nullable(body.thickness),
    thickness_target: nullable(body.thickness_target),
    diameter: nullable(body.diameter),
    diameter_target: nullable(body.diameter_target),
    weight: nullable(body.weight),
    weight_target: nullable(body.weight_target),
    visual_inspection: body.visual_inspection,
    comments: nullable(body.comments),
  }))
}

export async function PUT(req: Request) {
  return updateRecord(req, TABLE, TIRE_UPDATABLE, { permission: "manage" })
}
