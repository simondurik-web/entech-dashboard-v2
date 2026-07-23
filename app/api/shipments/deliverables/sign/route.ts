import { NextRequest, NextResponse } from 'next/server'
import { requirePermissionOrDevice } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'shipment-deliverables'
const DELIVERABLE_PATH = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\.pdf$/

export async function POST(req: NextRequest) {
  if (!(await requirePermissionOrDevice(req, '/shipments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { path?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const path = typeof body.path === 'string' ? body.path : ''
  if (!DELIVERABLE_PATH.test(path)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 120)

  if (error || !data?.signedUrl) {
    console.error('shipment deliverable signing failed:', error)
    return NextResponse.json({ error: 'Signing failed' }, { status: 502 })
  }

  return NextResponse.json(
    { url: data.signedUrl },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
