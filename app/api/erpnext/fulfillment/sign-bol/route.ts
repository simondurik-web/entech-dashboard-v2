import { NextRequest, NextResponse } from 'next/server'
import { erpNow } from '@/lib/erpnext/erp-time'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextGetDoc, erpnextUpdate } from '@/lib/erpnext/client'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'

// POST /api/erpnext/fulfillment/sign-bol  { dn, driverName, signature }
// Stores the driver's name + finger/mouse signature on the shipped Delivery
// Note (same fields ERPNext's BOL print format renders), so the BOL comes out
// digitally signed. Skipping the signature is a client-side choice — the BOL
// then prints with blank signature boxes for pencil (Simon 2026-07-03).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/
// PNG data URL from the signature canvas; ~500 KB cap keeps DN docs sane
const SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/=]{100,700000}$/

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: { dn?: string; driverName?: string; signature?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const dn = String(body.dn ?? '').trim()
  const driverName = String(body.driverName ?? '').trim().slice(0, 120)
  const signature = String(body.signature ?? '')
  if (!DN_NAME.test(dn) || !SIGNATURE.test(signature)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const doc = await erpnextGetDoc<{ docstatus: number; custom_ship_against_so?: string | null; customer?: string }>(
      'Delivery Note',
      dn
    )
    if (doc.docstatus !== 1 || !doc.custom_ship_against_so) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }
    const now = new Date()
    const stamp = erpNow(now)
    await erpnextUpdate('Delivery Note', dn, {
      custom_driver_name: driverName || null,
      received_by_name: driverName || null,
      received_date: stamp.slice(0, 10),
      receiver_signature: signature,
      custom_signed_at: stamp,
    })
    const userName = await resolveUserName(guard.userId)
    logFulfillment({
      action: 'sign_bol',
      so: doc.custom_ship_against_so,
      dn,
      customer: doc.customer,
      userId: guard.userId,
      userName: userName || guard.email,
      detail: driverName ? `driver: ${driverName}` : null,
    })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('sign BOL failed:', error)
    return NextResponse.json({ error: 'Could not save the signature. Try again.' }, { status: 502 })
  }
}
