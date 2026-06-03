import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveActor, logPurchasing } from '@/lib/purchasing/audit'
import { canAccessPurchasing } from '@/lib/purchasing/guard'
import { deriveDepartment } from '@/lib/purchasing/compute'
import { EDITABLE_FIELDS, type PurchasingInput } from '@/lib/purchasing/types'

export const dynamic = 'force-dynamic'

const NUMERIC = new Set(['quantity', 'total_cost', 'delivery_cost'])
const BOOLEAN = new Set(['canceled', 'refunded', 'urgent', 'partial_delivery'])
const VALID_STATUS = new Set(['Requested', 'Ordered', 'Received', 'Partial', 'Canceled', 'Refunded'])

/** Keep only known fields and coerce types; '' -> null. */
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

/** Fetch every non-deleted row, paginating past Supabase's 1000-row cap. */
export async function GET() {
  const pageSize = 1000
  const all: unknown[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('purchasing_orders')
      .select('*')
      .is('deleted_at', null)
      .order('date_requested', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    all.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return NextResponse.json({ orders: all })
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json()) as Record<string, unknown>
  const input = sanitize(body)
  if (!input.item_description) {
    return NextResponse.json({ error: 'Item Description is required' }, { status: 400 })
  }

  // Mirror sheet column O: auto-fill Department from Sub Department when blank.
  if (!input.department && input.sub_department) {
    const derived = deriveDepartment(input.sub_department)
    if (derived) input.department = derived
  }

  const { data, error } = await supabaseAdmin
    .from('purchasing_orders')
    .insert({ ...input, created_by: userId })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const actor = await resolveActor(userId)
  await logPurchasing(actor, [
    { order_id: data.id, item_description: data.item_description, action: 'created' },
  ])

  return NextResponse.json({ order: data })
}
