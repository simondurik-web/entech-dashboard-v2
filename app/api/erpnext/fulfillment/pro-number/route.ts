import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextGetDoc, erpnextUpdate } from '@/lib/erpnext/client'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'

// POST /api/erpnext/fulfillment/pro-number  { dns: string[], pro: string }
// Optional carrier PRO number, entered by shipping at print time (Simon
// 2026-07-17: "these numbers are important for freight" — not every load has
// one, so it's a plain optional box). Stored on the STANDARD Delivery Note
// field lr_no ("Transport Receipt No"; allow_on_submit via property setter) —
// a truckload writes the same PRO to every member DN. Empty pro clears it.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/
// carrier PROs are digits with occasional dashes/letters — keep it permissive
// but bounded, and reject anything that could be markup
const PRO_VALUE = /^[A-Za-z0-9 ./-]{0,30}$/

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: { dns?: unknown; pro?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const dns = Array.isArray(body.dns) ? body.dns.map((d) => String(d).trim()) : []
  const pro = String(body.pro ?? '').trim()
  if (
    dns.length === 0 ||
    dns.length > 20 ||
    dns.some((d) => !DN_NAME.test(d)) ||
    !PRO_VALUE.test(pro)
  ) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const failed: string[] = []
    for (const dn of dns) {
      try {
        const doc = await erpnextGetDoc<{
          docstatus: number
          custom_ship_against_so?: string | null
          customer?: string
          items?: { against_sales_order?: string | null }[]
        }>('Delivery Note', dn)
        const soLinked =
          doc.custom_ship_against_so ||
          (doc.items ?? []).map((i) => i.against_sales_order).find(Boolean) ||
          null
        if (doc.docstatus !== 1 || !soLinked) {
          failed.push(dn)
          continue
        }
        await erpnextUpdate('Delivery Note', dn, { lr_no: pro || null })
        logFulfillment({
          action: 'set_pro_number',
          so: soLinked,
          dn,
          customer: doc.customer,
          userId: guard.userId,
          detail: pro || '(cleared)',
        })
      } catch (e) {
        console.error('PRO number update failed:', dn, e)
        failed.push(dn)
      }
    }
    if (failed.length === dns.length) {
      return NextResponse.json({ error: 'Could not save the PRO number. Try again.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, failed }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('pro-number failed:', error)
    return NextResponse.json({ error: 'Could not save the PRO number. Try again.' }, { status: 502 })
  }
}
