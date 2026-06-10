import { createInspection, updateRecord, FINISHED_UPDATABLE, actorName, actorRole, nullable } from "@/lib/quality/api"

const TABLE = "qa_finished_inspections"

export async function POST(req: Request) {
  return createInspection(req, TABLE, (body, actor) => ({
    timestamp: new Date().toISOString(),
    inspector_role: actorRole(actor),
    inspector_name: actorName(actor),
    rt_number: body.rt_number,
    correct_tire: body.correct_tire,
    correct_hub: body.correct_hub,
    correct_hub_color: body.correct_hub_color,
    tire_od: nullable(body.tire_od),
    tire_thickness: nullable(body.tire_thickness),
    tire_weight: nullable(body.tire_weight),
    bore_check: body.bore_check,
    locking_mechanism: body.locking_mechanism,
    tire_visual: body.tire_visual,
    hub_visual: body.hub_visual,
    comments: nullable(body.comments),
  }))
}

export async function PUT(req: Request) {
  return updateRecord(req, TABLE, FINISHED_UPDATABLE, { permission: "manage" })
}
