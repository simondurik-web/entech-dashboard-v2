import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPurchasing } from '@/lib/purchasing/guard'
import { requireUser } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

const FIELDS = new Set(['department', 'sub_department', 'person'])

/** GET -> { department: [...], sub_department: [...], person: [...] } */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('purchasing_options')
    .select('field, value, sort_order')
    .order('field')
    .order('sort_order')
    .order('value')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const grouped: Record<string, string[]> = { department: [], sub_department: [], person: [] }
  for (const row of data ?? []) {
    if (!grouped[row.field]) grouped[row.field] = []
    grouped[row.field].push(row.value)
  }
  return NextResponse.json({ options: grouped })
}

/** POST { field, value } -> add a new option (gated). */
export async function POST(req: NextRequest) {
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json()) as { field?: string; value?: string }
  const field = String(body.field || '')
  const value = String(body.value || '').trim()
  if (!FIELDS.has(field)) return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  if (!value) return NextResponse.json({ error: 'Value is required' }, { status: 400 })

  if (value.length > 200) return NextResponse.json({ error: 'Value too long' }, { status: 400 })

  // Append after the current max sort_order for this field (delete-gap safe).
  const { data: maxRow } = await supabaseAdmin
    .from('purchasing_options')
    .select('sort_order')
    .eq('field', field)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { error } = await supabaseAdmin
    .from('purchasing_options')
    .upsert({ field, value, sort_order: nextOrder }, { onConflict: 'field,value', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, value })
}

/** PATCH { field, oldValue, newValue } -> rename an option (gated). Only edits
 *  the list; existing orders keep their stored value. */
export async function PATCH(req: NextRequest) {
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json()) as { field?: string; oldValue?: string; newValue?: string }
  const field = String(body.field || '')
  const oldValue = String(body.oldValue || '')
  const newValue = String(body.newValue || '').trim()
  if (!FIELDS.has(field)) return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  if (!oldValue || !newValue) return NextResponse.json({ error: 'oldValue and newValue are required' }, { status: 400 })
  if (newValue.length > 200) return NextResponse.json({ error: 'Value too long' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('purchasing_options')
    .update({ value: newValue })
    .eq('field', field)
    .eq('value', oldValue)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, value: newValue })
}

/** DELETE { field, value } -> remove an option (gated). Existing orders keep
 *  their stored value; this only removes it from the dropdown list. */
export async function DELETE(req: NextRequest) {
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { field?: string; value?: string }
  const field = String(body.field || '')
  const value = String(body.value || '')
  if (!FIELDS.has(field)) return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  if (!value) return NextResponse.json({ error: 'value is required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('purchasing_options')
    .delete()
    .eq('field', field)
    .eq('value', value)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
