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

/**
 * Error responses carry a stable `code` the client maps to a localized string,
 * plus an English `error` for logs and non-browser callers. Without the code
 * the page collapsed every failure into one generic "could not be queued",
 * so a 21.5 MB deliverable hitting the size guard on 2026-07-25 cost a morning
 * of diagnosis for something this route already knew.
 */
function fail(code: string, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { code, error: message, ...extra },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function POST(req: NextRequest) {
  // requirePermissionOrDevice: per-user custom_permissions grants/denies apply
  // (matching the client's canAccessExact), and approved floor devices with a
  // permitted role can print — the shipping-floor tablets are the actual users
  // of this page. The station ACL below still gates WHERE they can print.
  const actor = await requirePermissionOrDevice(req, 'shipments:print')
  if (!actor) return fail('errForbidden', 'Forbidden', 403)
  const role = actor.kind === 'device' ? (actor.role ?? '') : (await loadDashboardProfile(actor.id)).role

  let body: { date?: unknown; path?: unknown; station?: unknown; copies?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail('errInvalidRequest', 'Invalid request', 400)
  }

  const date = typeof body.date === 'string' ? body.date : ''
  const path = typeof body.path === 'string' ? body.path : ''
  const station = typeof body.station === 'string' ? body.station.trim() : ''
  // Integer 1-5: a fractional value would truncate in Array.from while the
  // response echoed the raw number — physical action and audit must agree.
  const copies = Math.min(5, Math.max(1, Math.floor(Number(body.copies)) || 1))

  if (!isRealDate(date) || !DELIVERABLE_PATH.test(path) || !path.startsWith(`${date}/`) || !station) {
    return fail('errInvalidRequest', 'Invalid request', 400)
  }
  const basename = path.slice(date.length + 1).toLowerCase()
  const isZebraFile = ZEBRA_PREFIXES.some((prefix) => basename.startsWith(prefix))
  const isLetterFile = LETTER_PREFIXES.some((prefix) => basename.startsWith(prefix))
  if (!isZebraFile && !isLetterFile) {
    return fail('errUnsupportedFile', 'unsupported_file', 422)
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
      return fail('errNoLabelPrinter', 'That station has no label printer', 400)
    }
    if (isLetterFile && !st?.letter_printer) {
      return fail('errNoPaperPrinter', 'That station has no paper printer', 400)
    }
    if (!(await userCanPrintTo(actor.id, role, station))) {
      return fail('errNotAllowed', 'Not allowed to print to this station', 403)
    }

    const { data: file, error: downloadError } = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (downloadError || !file) {
      return fail('errFileMissing', 'File not found', 404)
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    // Round UP: a 10.04 MB file rounded to nearest would report "10 MB, limit
    // 10 MB" and read as a contradiction. Ceiling keeps the number strictly
    // above the limit whenever the file actually is.
    const sizeMb = Math.ceil((bytes.length / 1024 / 1024) * 10) / 10
    const maxMb = Math.round(MAX_BYTES / 1024 / 1024)
    if (bytes.length > MAX_BYTES) {
      // State the ACTUAL size and the limit: "too large" alone is what made
      // this un-diagnosable from the screen.
      return fail(
        'errTooLarge',
        `File too large for the relay (${sizeMb} MB, limit ${maxMb} MB) — use View + AirPrint`,
        413,
        { sizeMb, maxMb }
      )
    }
    if (!(bytes.length > 4 && bytes[0] === 0x25)) {
      return fail('errNotPdf', 'File is not a PDF', 422)
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
    return fail('errGeneric', 'Print failed. Try again.', 502)
  }
}
