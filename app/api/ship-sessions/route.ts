import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Ship sessions — server-side scan progress for the Ship Order flow.
// Saved after every scan so a refresh / dead phone / Wi-Fi drop never loses
// progress (the incident that motivated this: a mid-scan refresh restarted
// the whole load from zero). One active session per SO (single mode) or per
// truckload; a second device adopts the same session and picks up where the
// first left off.
//
// GET  ?so=SO-00020            -> active single-order session (or null)
// GET  ?tl=<truckload uuid>    -> active truckload session (or null)
// POST { so, truckloadId?, scanned, completed?, driverName? } -> upsert
// PATCH { id, status: completed|abandoned }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/
const UUID = /^[0-9a-f-]{36}$/

interface SessionRow {
  id: string
  truckload_id: string | null
  so_number: string
  scanned: unknown
  completed: unknown
  driver_name: string | null
  status: string
  created_by_name: string | null
  updated_at: string
}

const COLS = 'id, truckload_id, so_number, scanned, completed, driver_name, status, created_by_name, updated_at'

async function findActive(so: string | null, tl: string | null): Promise<SessionRow | null> {
  let q = supabaseAdmin.from('ship_sessions').select(COLS).eq('status', 'active')
  if (tl) q = q.eq('truckload_id', tl)
  else q = q.eq('so_number', so!).is('truckload_id', null)
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res
  const so = req.nextUrl.searchParams.get('so')
  const tl = req.nextUrl.searchParams.get('tl')
  if (tl ? !UUID.test(tl) : !so || !SO_NAME.test(so)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    const session = await findActive(so, tl)
    return NextResponse.json({ session }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('ship session get failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res
  let body: {
    so?: unknown
    truckloadId?: unknown
    scanned?: unknown
    completed?: unknown
    driverName?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const so = String(body.so ?? '').trim()
  const tl = body.truckloadId ? String(body.truckloadId) : null
  if (!SO_NAME.test(so) || (tl && !UUID.test(tl))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  // Scan payloads are small (pallet ids + reasons); cap defensively so a bug
  // can't balloon rows.
  const scanned = body.scanned && typeof body.scanned === 'object' ? body.scanned : {}
  const completed = Array.isArray(body.completed) ? body.completed : []
  if (JSON.stringify(scanned).length > 100_000 || JSON.stringify(completed).length > 20_000) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  try {
    const existing = await findActive(tl ? null : so, tl)
    const patch = {
      so_number: so,
      scanned,
      completed,
      driver_name: typeof body.driverName === 'string' ? body.driverName.slice(0, 120) : null,
      updated_at: new Date().toISOString(),
    }
    if (existing) {
      const { error } = await supabaseAdmin.from('ship_sessions').update(patch).eq('id', existing.id).eq('status', 'active')
      if (error) throw new Error(error.message)
      return NextResponse.json({ id: existing.id }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const userName = (await resolveUserName(guard.userId)) || guard.email
    const { data, error } = await supabaseAdmin
      .from('ship_sessions')
      .insert({ ...patch, truckload_id: tl, created_by: guard.userId, created_by_name: userName })
      .select('id')
      .single()
    if (error) {
      // unique-race: another device created the session a beat earlier — adopt it
      if (error.code === '23505') {
        const adopted = await findActive(tl ? null : so, tl)
        if (adopted) {
          await supabaseAdmin.from('ship_sessions').update(patch).eq('id', adopted.id)
          return NextResponse.json({ id: adopted.id }, { headers: { 'Cache-Control': 'no-store' } })
        }
      }
      throw new Error(error.message)
    }
    return NextResponse.json({ id: data.id }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('ship session save failed:', error)
    return NextResponse.json({ error: 'Save failed' }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res
  let body: { id?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const id = String(body.id ?? '')
  const status = String(body.status ?? '')
  if (!UUID.test(id) || !['completed', 'abandoned'].includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    const { error } = await supabaseAdmin
      .from('ship_sessions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'active')
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('ship session close failed:', error)
    return NextResponse.json({ error: 'Save failed' }, { status: 502 })
  }
}
