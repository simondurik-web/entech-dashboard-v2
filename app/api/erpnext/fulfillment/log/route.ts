import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { listFulfillmentLog } from '@/lib/erpnext/fulfillment-audit'

// GET /api/erpnext/fulfillment/log?so=<SO>
// The order's load log — every complete / undo / sign / customer-BOL upload
// with who and when (audit trail, Simon 2026-07-03).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res

  const so = req.nextUrl.searchParams.get('so')?.trim() ?? ''
  if (!SO_NAME.test(so)) return NextResponse.json({ error: 'Invalid sales order' }, { status: 400 })
  try {
    const entries = await listFulfillmentLog(so)
    return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('fulfillment log failed:', error)
    return NextResponse.json({ error: 'Log unavailable' }, { status: 502 })
  }
}
