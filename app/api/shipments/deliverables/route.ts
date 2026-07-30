import { NextRequest, NextResponse } from 'next/server'
import { requirePermissionOrDevice } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isRealDate, todayET } from '@/lib/shipments/et-date'
import { fileKind, filePartner } from '@/lib/shipments/deliverable-classify'
import type { DeliverableFile } from '@/lib/shipments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'shipment-deliverables'

export async function GET(req: NextRequest) {
  if (!(await requirePermissionOrDevice(req, '/shipments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const date = req.nextUrl.searchParams.get('date') ?? todayET()
  if (!isRealDate(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(`${date}/`, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })

  if (error) {
    console.error('shipment deliverables lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }

  const files: DeliverableFile[] = (data ?? [])
    .filter((file) => file.name.toLowerCase().endsWith('.pdf'))
    .map((file) => {
      const rawSize = file.metadata?.size
      const parsedSize = rawSize == null ? null : Number(rawSize)
      return {
        name: file.name,
        path: `${date}/${file.name}`,
        size: parsedSize !== null && Number.isFinite(parsedSize) ? parsedSize : null,
        kind: fileKind(file.name),
        partner: filePartner(file.name),
      }
    })

  return NextResponse.json(
    { date, files },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
