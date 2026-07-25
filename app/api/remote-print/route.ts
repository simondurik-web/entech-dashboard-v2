import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { allowedStationIds, userCanPrintTo } from '@/lib/erpnext/printer-access'
import { loadDashboardProfile, requirePermission, requireUser } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024
// One row is inserted per copy, each carrying its own base64 payload, so the
// INSERT grows with payload × copies. Cap the PRODUCT as well as the file, and
// measure the ENCODED payload — base64 is ~33% larger than the raw PDF.
const MAX_TOTAL_PAYLOAD_BYTES = 16 * 1024 * 1024
// Byte caps do not bound physical output: a small 300-page PDF × 20 copies is
// 6000 sheets. Bound the paper, not just the upload.
const MAX_TOTAL_PAGES = 200
const MAX_COPIES = 20
// The floor agent drains `pending` in seconds, so a large backlog means
// something is wrong. Bounds sustained flooding without a rate-limit service.
const MAX_PENDING_PER_USER = 60
// pdf-lib decodes PNG to raw pixels (JPEG is embedded as-is), so a small
// well-compressed PNG can expand into gigabytes. 25 MP ≈ 100 MB decoded.
const MAX_IMAGE_PIXELS = 25_000_000
const PAPER_PAGE = { width: 612, height: 792, margin: 36 }
const LABEL_PAGE = { width: 288, height: 432, margin: 9 }

class ImageTooLargeError extends Error {}

type PrinterKind = 'paper' | 'label'
type UploadKind = 'pdf' | 'jpeg' | 'png'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Actor = { userId: string; role: string }

/**
 * `requirePermission` (not `requireMenuAccess`) so a per-user
 * `custom_permissions` DENIAL is honored server-side exactly as the client's
 * canAccess honors it — a role grant must not override a user-level `false`.
 * Authentication and authorization stay separate so an expired token still
 * gets a 401 and lets authedFetch refresh, instead of a misleading 403.
 */
async function authorize(req: NextRequest): Promise<Actor | NextResponse> {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permitted = await requirePermission(req, '/remote-printing')
  if (!permitted) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [{ role }, { data: profile }] = await Promise.all([
    loadDashboardProfile(user.id),
    supabaseAdmin.from('user_profiles').select('is_active').eq('id', user.id).maybeSingle(),
  ])
  // Deactivating a user only flips this flag: the role, the printer grants and
  // any already-issued token all survive, and no shared auth helper consults
  // it. Enforce it here so a deactivated account cannot keep putting paper
  // through a floor printer from a session nobody revoked.
  if (profile?.is_active === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { userId: user.id, role }
}

/**
 * Error responses carry a stable `code` the client maps to a localized string,
 * plus an English `error` as a fallback for non-browser callers and logs.
 */
function fail(code: string, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { code, error: message, ...extra },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}

function detectUploadKind(bytes: Uint8Array): UploadKind | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return 'pdf'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  return null
}

function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const brand = String.fromCharCode(...bytes.subarray(4, 12))
  return brand === 'ftypheic' || brand === 'ftypheix' || brand === 'ftypmif1'
}

function sanitizedFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? ''
  return basename.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'upload'
}

/**
 * Width/height from the PNG IHDR chunk, which is always first: 8-byte
 * signature, 4-byte length, "IHDR", then two big-endian uint32s. Read BEFORE
 * embedding so a decompression bomb is rejected rather than decoded.
 */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

async function imageToPdf(bytes: Uint8Array, uploadKind: Exclude<UploadKind, 'pdf'>, printerKind: PrinterKind) {
  if (uploadKind === 'png') {
    const dimensions = pngDimensions(bytes)
    if (dimensions && dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
      throw new ImageTooLargeError('PNG exceeds the pixel limit')
    }
  }
  const pdf = await PDFDocument.create()
  const image = uploadKind === 'jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  const pageSize = printerKind === 'paper' ? PAPER_PAGE : LABEL_PAGE
  const fitScale = Math.min(
    (pageSize.width - pageSize.margin * 2) / image.width,
    (pageSize.height - pageSize.margin * 2) / image.height
  )
  const scale = Math.min(1, fitScale)
  const width = image.width * scale
  const height = image.height * scale
  const page = pdf.addPage([pageSize.width, pageSize.height])
  page.drawImage(image, {
    x: (pageSize.width - width) / 2,
    y: (pageSize.height - height) / 2,
    width,
    height,
  })
  return pdf.save()
}

export async function GET(req: NextRequest) {
  const actor = await authorize(req)
  if (actor instanceof NextResponse) return actor

  try {
    const { data, error } = await supabaseAdmin
      .from('print_stations')
      .select('id, name, letter_printer, zebra_pdf')
      .eq('enabled', true)
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)

    const allowed = await allowedStationIds(actor.userId, actor.role)
    const printers = (data ?? [])
      .filter((station) => allowed === 'all' || allowed.has(station.id))
      .flatMap((station) => {
        const entries: { id: string; stationId: string; name: string; kind: PrinterKind }[] = []
        if (station.letter_printer) {
          entries.push({
            id: `${station.id}:paper`,
            stationId: station.id,
            name: station.name,
            kind: 'paper',
          })
        }
        if (station.zebra_pdf === true) {
          entries.push({
            id: `${station.id}:label`,
            stationId: station.id,
            name: station.name,
            kind: 'label',
          })
        }
        return entries
      })
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          (left.kind === right.kind ? 0 : left.kind === 'paper' ? -1 : 1)
      )

    return NextResponse.json({ printers }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('remote printer lookup failed:', errorMessage(error))
    return fail(
      'errPrintersLoad',
      'We could not load the available printers. Please try again.',
      502
    )
  }
}

export async function POST(req: NextRequest) {
  const actor = await authorize(req)
  if (actor instanceof NextResponse) return actor

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail('errGeneric', 'The uploaded form could not be read. Please try again.', 400)
  }

  const copiesField = form.get('copies')
  const copiesNumber =
    typeof copiesField === 'string' && copiesField.trim() !== '' ? Number(copiesField) : Number.NaN
  // Reject rather than clamp: silently turning 999 into 20 hides a broken
  // client and breaks the contract the error message states.
  if (
    !Number.isFinite(copiesNumber) ||
    !Number.isInteger(copiesNumber) ||
    copiesNumber < 1 ||
    copiesNumber > MAX_COPIES
  ) {
    return fail('errCopies', `Copies must be a whole number between 1 and ${MAX_COPIES}.`, 400)
  }
  const copies = copiesNumber

  const printerField = form.get('printer')
  const printerMatch =
    typeof printerField === 'string' ? /^(.+):(paper|label)$/.exec(printerField.trim()) : null
  if (!printerMatch) {
    return fail('errPrinterInvalid', 'Choose a valid paper or 4x6 label printer.', 400)
  }
  const stationId = printerMatch[1]
  const kind = printerMatch[2] as PrinterKind

  try {
    const { data: station, error: stationError } = await supabaseAdmin
      .from('print_stations')
      .select('id, letter_printer, zebra_pdf')
      .eq('id', stationId)
      .eq('enabled', true)
      .maybeSingle()
    if (stationError) throw new Error(stationError.message)
    // ACL first: checking capability before permission would let anyone with
    // menu access probe which stations exist and what hardware they have by
    // reading apart the distinct error codes.
    if (!(await userCanPrintTo(actor.userId, actor.role, stationId))) {
      return fail('errNotAllowed', 'You are not allowed to print to that station.', 403)
    }
    if (!station) {
      return fail('errStationUnavailable', 'That printer station is unavailable or disabled.', 400)
    }
    if (kind === 'paper' && !station.letter_printer) {
      return fail(
        'errNoPaperPrinter',
        'That station does not have an available paper printer.',
        400
      )
    }
    if (kind === 'label' && station.zebra_pdf !== true) {
      return fail('errNoLabelPrinter', 'That station does not support 4x6 label printing.', 400)
    }

    const fileField = form.get('file')
    if (!(fileField instanceof File)) {
      return fail('errNoFile', 'Choose a file to print.', 400)
    }
    if (fileField.size > MAX_BYTES) {
      return fail('errTooLarge', 'This file is too large. Choose a file no larger than 10 MB.', 413)
    }

    const bytes = new Uint8Array(await fileField.arrayBuffer())
    const uploadKind = detectUploadKind(bytes)
    if (!uploadKind) {
      if (isHeic(bytes)) {
        return fail(
          'errHeic',
          'HEIC files are not supported. Re-save the image as JPEG or PNG, or take a screenshot and upload that.',
          415
        )
      }
      return fail('errUnsupported', 'Unsupported file. Choose a PDF, JPEG, or PNG file.', 415)
    }

    let pdfBytes: Uint8Array
    try {
      pdfBytes = uploadKind === 'pdf' ? bytes : await imageToPdf(bytes, uploadKind, kind)
    } catch (error) {
      if (error instanceof ImageTooLargeError) {
        return fail('errImageTooLarge', 'That image has too many pixels to print.', 413)
      }
      return fail('errUnsupported', 'That file could not be read as a printable document.', 415)
    }

    // An uploaded PDF is passed through untouched, so count its pages to bound
    // the paper. `ignoreEncryption` keeps password-protected PDFs countable
    // instead of unreadable; anything that still fails to parse is refused
    // rather than waved through, since an uncountable PDF would otherwise skip
    // the page cap entirely.
    let pageCount: number
    if (uploadKind === 'pdf') {
      try {
        pageCount = (
          await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true })
        ).getPageCount()
      } catch {
        return fail(
          'errPdfUnreadable',
          'This PDF could not be read. Re-save or re-export it and try again.',
          400
        )
      }
    } else {
      pageCount = 1
    }
    if (pageCount > MAX_TOTAL_PAGES) {
      return fail(
        'errDocumentTooLong',
        `This document is ${pageCount} pages; the limit is ${MAX_TOTAL_PAGES} per job.`,
        413,
        { pages: pageCount, max: MAX_TOTAL_PAGES }
      )
    }
    if (pageCount * copies > MAX_TOTAL_PAGES) {
      const maxCopies = Math.floor(MAX_TOTAL_PAGES / pageCount)
      return fail(
        'errTooManyPages',
        `That is ${pageCount * copies} pages. Print at most ${maxCopies} copies of a ${pageCount}-page document.`,
        413,
        { pages: pageCount, maxCopies }
      )
    }

    // Each copy is its own row carrying the full payload; a big file × many
    // copies would otherwise become a single multi-hundred-MB INSERT that the
    // API rejects and the floor agent then has to pull over Tailscale.
    const payload = Buffer.from(pdfBytes).toString('base64')
    if (payload.length * copies > MAX_TOTAL_PAYLOAD_BYTES) {
      const maxCopies = Math.max(1, Math.floor(MAX_TOTAL_PAYLOAD_BYTES / payload.length))
      return fail(
        'errTotalTooLarge',
        `This file is too large to print ${copies} times at once. Print at most ${maxCopies} at a time.`,
        413,
        { maxCopies }
      )
    }

    // Every cap above is per-request; without this, repeated requests still add
    // up to unlimited paper. The agent claims pending jobs within seconds, so a
    // backlog this size means a stuck station or a runaway client either way.
    const { count: pending } = await supabaseAdmin
      .from('print_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', actor.userId)
      .eq('status', 'pending')
    if ((pending ?? 0) + copies > MAX_PENDING_PER_USER) {
      return fail(
        'errQueueFull',
        'You already have print jobs waiting. Let them finish before sending more.',
        429
      )
    }

    const stamp = Date.now()
    const { error: insertError } = await supabaseAdmin.from('print_jobs').insert(
      Array.from({ length: copies }, (_, index) => ({
        station_id: stationId,
        format: 'pdf',
        zpl: payload,
        item_code: 'REMOTE-PRINT',
        batch: sanitizedFilename(fileField.name),
        target: kind === 'label' ? 'zebra' : null,
        created_by: actor.userId,
        idempotency_key: `remote-${actor.userId}-${stamp}-${index + 1}`, // reprints are intentional
        status: 'pending',
      }))
    )
    if (insertError) throw new Error(insertError.message)

    return NextResponse.json(
      { queued: copies },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('remote print failed:', errorMessage(error))
    return fail(
      'errGeneric',
      'We could not send this file to the printer. Please try again.',
      502
    )
  }
}
