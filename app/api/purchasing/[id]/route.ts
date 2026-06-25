import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveActor, logPurchasing, auditStr, type AuditEntry } from '@/lib/purchasing/audit'
import { canAccessPurchasing } from '@/lib/purchasing/guard'
import { EDITABLE_FIELDS, type PurchasingInput, type PurchasingOrder } from '@/lib/purchasing/types'
import { requireUser } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

const NUMERIC = new Set(['quantity', 'total_cost', 'delivery_cost'])
const BOOLEAN = new Set(['canceled', 'refunded', 'urgent', 'partial_delivery'])
const VALID_STATUS = new Set(['Requested', 'Ordered', 'Received', 'Partial', 'Canceled', 'Refunded'])

function sanitize(body: Record<string, unknown>): PurchasingInput {
  const out: Record<string, unknown> = {}
  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue
    let v = body[key]
    if (BOOLEAN.has(key)) {
      out[key] = v === true || v === 'true'
    } else if (NUMERIC.has(key)) {
      if (v === '' || v === null || v === undefined) out[key] = null
      else {
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''))
        out[key] = Number.isNaN(n) ? null : n
      }
    } else if (key === 'status_override') {
      const sv = typeof v === 'string' ? v.trim() : ''
      out[key] = VALID_STATUS.has(sv) ? sv : null
    } else {
      if (typeof v === 'string') v = v.trim()
      out[key] = v === '' || v === undefined ? null : v
    }
  }
  return out as PurchasingInput
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('purchasing_orders')
    .select('*')
    .eq('id', id)
    .single()
  if (fetchErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json()) as Record<string, unknown>
  const actor = await resolveActor(userId)

  // Restore a soft-deleted row
  if (body.restore === true) {
    const { data, error } = await supabaseAdmin
      .from('purchasing_orders')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logPurchasing(actor, [{ order_id: id, item_description: data.item_description, action: 'restored' }])
    return NextResponse.json({ order: data })
  }

  const input = sanitize(body)
  const row = existing as PurchasingOrder

  // Diff changed fields for the audit trail.
  // Numeric columns come back from supabase-js as strings (e.g. "250.00"), so
  // normalize them before comparing or every edit logs phantom changes.
  const numStr = (v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isNaN(n) ? auditStr(v) : String(n)
  }
  const changes: AuditEntry[] = []
  for (const key of EDITABLE_FIELDS) {
    if (!(key in input)) continue
    const isNumeric = NUMERIC.has(key)
    const before = isNumeric ? numStr(row[key as keyof PurchasingOrder]) : auditStr(row[key as keyof PurchasingOrder])
    const after = isNumeric ? numStr(input[key]) : auditStr(input[key])
    if (before !== after) {
      changes.push({
        order_id: id,
        item_description: input.item_description ?? row.item_description,
        action: 'updated',
        field_name: key,
        old_value: before,
        new_value: after,
      })
    }
  }

  if (changes.length === 0) return NextResponse.json({ order: row, unchanged: true })

  const { data, error } = await supabaseAdmin
    .from('purchasing_orders')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logPurchasing(actor, changes)
  return NextResponse.json({ order: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing } = await supabaseAdmin
    .from('purchasing_orders')
    .select('id, item_description')
    .eq('id', id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('purchasing_orders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const actor = await resolveActor(userId)
  await logPurchasing(actor, [
    { order_id: id, item_description: existing.item_description, action: 'deleted' },
  ])
  return NextResponse.json({ ok: true })
}
