import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireDashboardAccess } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

const TABLE = 'user_table_prefs'
// Sanity caps — a table has a few dozen columns at most; anything bigger is a
// malformed or malicious payload, not a real preference.
const MAX_KEYS = 200
const MAX_KEY_LEN = 120
// There are only a few dozen tables in the app; a user hitting this is a bug
// or someone minting rows with arbitrary storage_keys.
const MAX_PREF_ROWS_PER_USER = 100

/**
 * Per-user, cross-device column preferences for data tables (hidden columns +
 * column order), keyed by the table's storageKey. Complements — does not
 * replace — the localStorage cache in use-data-table: localStorage gives an
 * instant first paint, this gives the same view on every device the user logs
 * into (Simon 2026-07-07: column changes must be per-user and visible on the
 * iPhone, not per-browser).
 */

function cleanKeyList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > MAX_KEYS) return null
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || v.length > MAX_KEY_LEN) return null
    out.push(v)
  }
  return out
}

export async function GET(req: NextRequest) {
  const user = await requireDashboardAccess(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = (req.nextUrl.searchParams.get('key') ?? '').trim()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('hidden_columns, column_order')
    .eq('user_id', user.id)
    .eq('storage_key', key)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Lookup failed' }, { status: 503 })
  return NextResponse.json({ prefs: data ?? null })
}

export async function PUT(req: NextRequest) {
  const user = await requireDashboardAccess(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { key?: string; hiddenColumns?: unknown; columnOrder?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const key = (body.key ?? '').trim()
  if (!key || key.length > MAX_KEY_LEN) {
    return NextResponse.json({ error: 'key required' }, { status: 400 })
  }
  const hidden = cleanKeyList(body.hiddenColumns)
  const order = cleanKeyList(body.columnOrder)
  if (hidden === null || order === null) {
    return NextResponse.json({ error: 'Invalid columns payload' }, { status: 400 })
  }

  // Cap total rows per user (storage-exhaustion guard) — only when creating a
  // key we haven't seen; updates to existing keys always go through.
  const { count, error: countErr } = await supabaseAdmin
    .from(TABLE)
    .select('storage_key', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (countErr) return NextResponse.json({ error: 'Save failed' }, { status: 503 })
  if ((count ?? 0) >= MAX_PREF_ROWS_PER_USER) {
    const { data: existing } = await supabaseAdmin
      .from(TABLE)
      .select('storage_key')
      .eq('user_id', user.id)
      .eq('storage_key', key)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Too many saved layouts' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      user_id: user.id,
      storage_key: key,
      hidden_columns: hidden,
      column_order: order,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,storage_key' },
  )

  if (error) return NextResponse.json({ error: 'Save failed' }, { status: 503 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await requireDashboardAccess(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { key?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const key = (body.key ?? '').trim()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq('user_id', user.id)
    .eq('storage_key', key)

  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 503 })
  return NextResponse.json({ ok: true })
}
