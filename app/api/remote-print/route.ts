import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { allowedStationIds, userCanPrintTo } from '@/lib/erpnext/printer-access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024
// One row is inserted per copy, each carrying its own base64 payload, so the
// INSERT grows with payload × copies. Cap the PRODUCT as well as the file.
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const PAPER_PAGE = { width: 612, height: 792, margin: 36 }
const LABEL_PAGE = { width: 288, height: 432, margin: 9 }

type PrinterKind = 'paper' | 'label'
type UploadKind = 'pdf' | 'jpeg' | 'png'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

async function imageToPdf(bytes: Uint8Array, uploadKind: Exclude<UploadKind, 'pdf'>, printerKind: PrinterKind) {
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
  const guard = await requireMenuAccess(req, '/remote-printing')
  if (!guard.ok) return guard.res

  try {
    const { data, error } = await supabaseAdmin
      .from('print_stations')
      .select('id, name, letter_printer, zebra_pdf')
      .eq('enabled', true)
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)

    const allowed = await allowedStationIds(guard.userId, guard.role)
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
  const guard = await requireMenuAccess(req, '/remote-printing')
  if (!guard.ok) return guard.res

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail('errGeneric', 'The uploaded form could not be read. Please try again.', 400)
  }

  const copiesField = form.get('copies')
  const copiesNumber =
    typeof copiesField === 'string' && copiesField.trim() !== '' ? Number(copiesField) : Number.NaN
  if (!Number.isFinite(copiesNumber) || !Number.isInteger(copiesNumber)) {
    return fail('errCopies', 'Copies must be a whole number between 1 and 20.', 400)
  }
  const copies = Math.min(20, Math.max(1, copiesNumber))

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

    if (!(await userCanPrintTo(guard.userId, guard.role, stationId))) {
      return fail('errNotAllowed', 'You are not allowed to print to that station.', 403)
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

    const pdfBytes =
      uploadKind === 'pdf' ? bytes : await imageToPdf(bytes, uploadKind, kind)

    // Each copy is its own row carrying the full payload; a big file × many
    // copies would otherwise become a single multi-hundred-MB INSERT that the
    // API rejects and the floor agent then has to pull over Tailscale.
    if (pdfBytes.length * copies > MAX_TOTAL_BYTES) {
      const maxCopies = Math.max(1, Math.floor(MAX_TOTAL_BYTES / pdfBytes.length))
      return fail(
        'errTotalTooLarge',
        `This file is too large to print ${copies} times at once. Print at most ${maxCopies} at a time.`,
        413,
        { maxCopies }
      )
    }

    const payload = Buffer.from(pdfBytes).toString('base64')
    const stamp = Date.now()
    const { error: insertError } = await supabaseAdmin.from('print_jobs').insert(
      Array.from({ length: copies }, (_, index) => ({
        station_id: stationId,
        format: 'pdf',
        zpl: payload,
        item_code: 'REMOTE-PRINT',
        batch: sanitizedFilename(fileField.name),
        target: kind === 'label' ? 'zebra' : null,
        created_by: guard.userId,
        idempotency_key: `remote-${guard.userId}-${stamp}-${index + 1}`,
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
