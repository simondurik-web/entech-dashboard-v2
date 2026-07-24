import { NextRequest, NextResponse } from 'next/server'
import { loadDashboardProfile, requirePermissionOrDevice } from '@/lib/require-user'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { isRealDate } from '@/lib/shipments/et-date'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Relay-print a shipment deliverable PDF to a station's LETTER printer via
// print_jobs (base64 pdf payload; the station agent prints through CUPS).
// LETTER FILES ONLY: the deployed agents route every format='pdf' job to the
// letter printer, so a 4x6 labels-print PDF must never be enqueued here — it
// would come out on letter paper. Zebra PDF dispatch arrives with the agent
// upgrade (see specs/shipments-analytics.md S5).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'shipment-deliverables'
const DELIVERABLE_PATH = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\.pdf$/
// Compared case-insensitively — the deliverables listing classifies kinds on
// lowercased names, so a casing drift in the uploader must not strand a file
// the UI already offers to print.
const LETTER_PREFIXES = ['packing-slips-fedex-', 'packing-slips-ltl-', 'run-summary-']
// 4x6 label PDFs go to a station's DRIVER-based Zebra queue (agent v3 prints
// them with PageSize=w288h432; stations advertise the capability via
// print_stations.zebra_pdf — only set after that station's agent is upgraded,
// because older agents would route the job to the letter printer).
const ZEBRA_PREFIXES = ['labels-print-']
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  // requirePermissionOrDevice: per-user custom_permissions grants/denies apply
  // (matching the client's canAccessExact), and approved floor devices with a
  // permitted role can print — the shipping-floor tablets are the actual users
  // of this page. The station ACL below still gates WHERE they can print.
  const actor = await requirePermissionOrDevice(req, 'shipments:print')
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const role = actor.kind === 'device' ? (actor.role ?? '') : (await loadDashboardProfile(actor.id)).role

  let body: { date?: unknown; path?: unknown; station?: unknown; copies?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const date = typeof body.date === 'string' ? body.date : ''
  const path = typeof body.path === 'string' ? body.path : ''
  const station = typeof body.station === 'string' ? body.station.trim() : ''
  // Integer 1-5: a fractional value would truncate in Array.from while the
  // response echoed the raw number — physical action and audit must agree.
  const copies = Math.min(5, Math.max(1, Math.floor(Number(body.copies)) || 1))

  if (!isRealDate(date) || !DELIVERABLE_PATH.test(path) || !path.startsWith(`${date}/`) || !station) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const basename = path.slice(date.length + 1).toLowerCase()
  const isZebraFile = ZEBRA_PREFIXES.some((prefix) => basename.startsWith(prefix))
  const isLetterFile = LETTER_PREFIXES.some((prefix) => basename.startsWith(prefix))
  if (!isZebraFile && !isLetterFile) {
    return NextResponse.json({ error: 'unsupported_file' }, { status: 422 })
  }

  try {
    const { data: st } = await supabaseAdmin
      .from('print_stations')
      .select('id, letter_printer, zebra_pdf')
      .eq('id', station)
      .eq('enabled', true)
      .single()
    // Never let a label land on letter paper or a packing slip on the Zebra:
    // the file type dictates which capability the station must have.
    if (isZebraFile && !st?.zebra_pdf) {
      return NextResponse.json({ error: 'That station has no label printer' }, { status: 400 })
    }
    if (isLetterFile && !st?.letter_printer) {
      return NextResponse.json({ error: 'That station has no paper printer' }, { status: 400 })
    }
    if (!(await userCanPrintTo(actor.id, role, station))) {
      return NextResponse.json({ error: 'Not allowed to print to this station' }, { status: 403 })
    }

    const { data: file, error: downloadError } = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (downloadError || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large for the relay — use View + AirPrint' }, { status: 413 })
    }
    if (!(bytes.length > 4 && bytes[0] === 0x25)) {
      return NextResponse.json({ error: 'File is not a PDF' }, { status: 422 })
    }

    const payload = Buffer.from(bytes).toString('base64')
    const stamp = Date.now()
    const { error } = await supabaseAdmin.from('print_jobs').insert(
      Array.from({ length: copies }, (_, i) => ({
        station_id: station,
        format: 'pdf',
        // Agent v3 routes target='zebra' pdf jobs to the driver-based Zebra
        // queue (PageSize=w288h432); letter jobs keep the v2 path unchanged.
        target: isZebraFile ? 'zebra' : null,
        zpl: payload,
        item_code: isZebraFile ? 'SHIPMENT-LABELS' : 'SHIPMENT-DOC',
        batch: date,
        created_by: actor.id,
        idempotency_key: `shipdlv-${path}-${stamp}-${i + 1}`, // reprints are intentional
        status: 'pending',
      }))
    )
    if (error) throw new Error(error.message)

    return NextResponse.json({ queued: copies }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('shipment deliverable print failed:', error)
    return NextResponse.json({ error: 'Print failed. Try again.' }, { status: 502 })
  }
}
