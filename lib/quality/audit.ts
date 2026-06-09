import { supabaseAdmin } from "@/lib/supabase-admin"

// Audit logger for Quality writes — writes to qa_audit_trail, mirroring the
// standalone EQDR app's lib/audit.ts. One row per field for creates/updates.

type ChangeType = "create" | "update" | "delete"

type AuditRow = {
  table_name: string
  record_id: number
  field_name: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_by_email: string | null
  change_type: ChangeType
}

const SKIP = new Set(["id", "created_at", "updated_at"])

function asStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "boolean") return v ? "true" : "false"
  return String(v)
}

async function insertRows(rows: AuditRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin.from("qa_audit_trail").insert(rows)
  if (error) console.error("qa_audit_trail insert failed:", error.message)
}

/** Log a created record — one entry per non-null field. */
export async function logQualityCreate(
  table: string,
  recordId: number,
  data: Record<string, unknown>,
  changedBy: string | null,
  changedByEmail: string | null,
): Promise<void> {
  const rows: AuditRow[] = []
  for (const [field_name, raw] of Object.entries(data)) {
    if (SKIP.has(field_name)) continue
    const new_value = asStr(raw)
    if (new_value === null) continue
    rows.push({ table_name: table, record_id: recordId, field_name, old_value: null, new_value, changed_by: changedBy, changed_by_email: changedByEmail, change_type: "create" })
  }
  await insertRows(rows)
}

/** Log an update — one entry per field whose value actually changed. */
export async function logQualityUpdate(
  table: string,
  recordId: number,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  changedBy: string | null,
  changedByEmail: string | null,
): Promise<void> {
  const rows: AuditRow[] = []
  for (const [field_name, raw] of Object.entries(newData)) {
    if (SKIP.has(field_name)) continue
    const old_value = asStr(oldData[field_name])
    const new_value = asStr(raw)
    if (old_value === new_value) continue
    rows.push({ table_name: table, record_id: recordId, field_name, old_value, new_value, changed_by: changedBy, changed_by_email: changedByEmail, change_type: "update" })
  }
  await insertRows(rows)
}
