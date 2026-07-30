import { NextRequest, NextResponse } from 'next/server'
import { requirePermissionOrDevice } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isRealDate, todayET } from '@/lib/shipments/et-date'
import type { DeliverableFile, DeliverableKind, DeliverablePartner } from '@/lib/shipments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'shipment-deliverables'

/** Repair slips carry no carrier token beyond the ones checked here, so we
 *  read the carrier out of the filename when we can and otherwise fall back to
 *  the generic letter-size packing kind (packing-fedex — today's repair path
 *  only re-emits Home Depot FedEx orders) rather than inventing a new kind. */
function repairPackingKind(lower: string): DeliverableKind {
  if (lower.includes('amazon') || lower.includes('ups')) return 'packing-ups'
  if (lower.includes('ltl')) return 'packing-ltl'
  return 'packing-fedex'
}

function fileKind(name: string): DeliverableKind {
  const lower = name.toLowerCase()
  if (lower.startsWith('packing-slips-fedex-')) return 'packing-fedex'
  if (lower.startsWith('packing-slips-ltl-')) return 'packing-ltl'
  if (lower.startsWith('labels-print-')) return 'labels'
  if (lower.startsWith('run-summary-')) return 'summary'
  if (lower.startsWith('packing-slips-amazon-')) return 'packing-ups'
  // The repair path emitted the singular packing-slip- form; accept both.
  if (lower.startsWith('packing-slip-repair-') || lower.startsWith('packing-slips-repair-')) {
    return repairPackingKind(lower)
  }
  if (lower.startsWith('labels-repair-')) return 'labels'
  return 'other'
}

function filePartner(name: string): DeliverablePartner {
  const lower = name.toLowerCase()
  if (lower.includes('-amazon-')) return 'amazon'
  if (
    lower.startsWith('packing-slips-fedex-') ||
    lower.startsWith('packing-slips-ltl-') ||
    lower.startsWith('labels-print-') ||
    lower.startsWith('run-summary-') ||
    // Repair files without an -amazon- token come from the Home Depot
    // (sps-order-intro) repair path.
    lower.startsWith('packing-slip-repair-') ||
    lower.startsWith('packing-slips-repair-') ||
    lower.startsWith('labels-repair-')
  ) {
    return 'home-depot'
  }
  return 'unknown'
}

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
