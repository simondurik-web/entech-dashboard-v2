import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { conflictingOrderKeys, conflictingOrderLines, distinctCustomers, listTruckloads } from '@/lib/truckloads'

// Truckloads — GET list / POST create.
//
// GET is gated on /staged (anyone who can see Ready to Ship sees the
// "ships together" banners); POST on manage_truckloads (decision 2,
// Simon 2026-07-08: admin + manager + shipping_manager).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/

interface OrderInput {
  soNumber: string
  orderKey: string
  ifNumber?: string
  customer?: string
  partNumber?: string
  palletCount?: number
  line?: number
}

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res
  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'active'
  try {
    const truckloads = await listTruckloads(scope)
    return NextResponse.json({ truckloads }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('truckloads list failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'manage_truckloads')
  if (!guard.ok) return guard.res

  let body: { notes?: unknown; calculatorState?: unknown; orders?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const rawOrders = Array.isArray(body.orders) ? (body.orders as OrderInput[]) : []
  const orders = rawOrders
    .map((o) => ({
      soNumber: String(o.soNumber ?? '').trim(),
      orderKey: String(o.orderKey ?? '').trim(),
      ifNumber: String(o.ifNumber ?? '').trim() || null,
      customer: String(o.customer ?? '').trim() || null,
      partNumber: String(o.partNumber ?? '').trim() || null,
      palletCount: Number.isFinite(Number(o.palletCount)) && Number(o.palletCount) > 0
        ? Math.min(999, Math.round(Number(o.palletCount)))
        : null,
      line: Number.isInteger(Number(o.line)) && Number(o.line) > 0 ? Number(o.line) : null,
    }))
    .filter((o) => o.orderKey && SO_NAME.test(o.soNumber))
  const uniqueKeys = new Set(orders.map((o) => o.orderKey))
  if (orders.length < 2 || uniqueKeys.size !== orders.length) {
    return NextResponse.json(
      { error: 'A truckload needs at least 2 distinct orders with ERP sales orders' },
      { status: 400 }
    )
  }

  // One truckload ships ONE customer (Simon 2026-07-10)
  const customers = distinctCustomers(orders.map((o) => o.customer))
  if (customers.length > 1) {
    return NextResponse.json(
      { error: `One truckload ships ONE customer — this one mixes ${customers.join(' + ')}` },
      { status: 409 }
    )
  }

  try {
    const conflicts = await conflictingOrderKeys([...uniqueKeys])
    if (conflicts.size > 0) {
      const [key, tl] = [...conflicts.entries()][0]
      return NextResponse.json(
        { error: `Order ${key.split('||')[0]} is already in ${tl}`, conflicts: Object.fromEntries(conflicts) },
        { status: 409 }
      )
    }
    // one LINE = one truckload (the key guard misses multi-release lines)
    const lineConflicts = await conflictingOrderLines(
      orders.map((o) => o.line).filter((l): l is number => l != null)
    )
    if (lineConflicts.size > 0) {
      const [line, tl] = [...lineConflicts.entries()][0]
      return NextResponse.json(
        { error: `Line ${line} is already on ${tl} — a line ships on exactly one truckload` },
        { status: 409 }
      )
    }

    const userName = (await resolveUserName(guard.userId)) || guard.email
    const { data: tl, error } = await supabaseAdmin
      .from('truckloads')
      .insert({
        notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
        calculator_state: body.calculatorState ?? null,
        created_by: guard.userId,
        created_by_name: userName,
      })
      .select('id, load_number')
      .single()
    if (error || !tl) throw new Error(error?.message || 'insert failed')

    const { error: ordersErr } = await supabaseAdmin.from('truckload_orders').insert(
      orders.map((o, i) => ({
        truckload_id: tl.id,
        so_number: o.soNumber,
        order_key: o.orderKey,
        if_number: o.ifNumber,
        customer: o.customer,
        part_number: o.partNumber,
        position: i,
        pallet_count: o.palletCount,
        line: o.line,
      }))
    )
    if (ordersErr) {
      // don't leave an empty shell behind
      await supabaseAdmin.from('truckloads').delete().eq('id', tl.id)
      throw new Error(ordersErr.message)
    }

    logFulfillment({
      action: 'tl_create',
      so: orders.map((o) => o.soNumber).join(','),
      dn: tl.load_number,
      userId: guard.userId,
      userName,
      detail: `${orders.length} orders`,
    })
    return NextResponse.json(
      { truckload: { id: tl.id, loadNumber: tl.load_number } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('truckload create failed:', error)
    return NextResponse.json({ error: 'Could not create the truckload. Try again.' }, { status: 502 })
  }
}
