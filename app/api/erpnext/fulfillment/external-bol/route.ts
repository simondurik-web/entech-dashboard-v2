import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextGetDoc, erpnextUploadFile } from '@/lib/erpnext/client'
import {
  ExternalBolUnsupportedError,
  externalBolToPdf,
  fetchExternalBolPdf,
  fetchOriginalExternalBol,
  findSignedBolObjects,
  getExternalBolState,
  newSignedBolPath,
  normalizeExternalPdf,
  resolveDnShipment,
  resolveOriginalSource,
  truckloadMemberDns,
} from '@/lib/erpnext/external-bol'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'
import { PO_DOC_BUCKET } from '@/lib/po-automation/documents'
import { supabaseAdmin } from '@/lib/supabase-admin'

// The carrier (customer-provided) BOL for a shipped Delivery Note.
//
// GET  ?dn=            -> { exists, signed, source, fileName }
// GET  ?dn=&raw=1      -> the PDF bytes (signed copy if present; &original=1
//                         forces the un-stamped original — the placement UI
//                         re-stamps from the original so a redo never stacks
//                         two signatures)
// POST { dn, page, x, y, w } -> stamp the driver's captured signature (the DN's
//   receiver_signature, drawn on the ship screen's sign pad) onto the external
//   BOL at the tapped spot. x/y = box top-left, w = box width, all normalized
//   0..1 against the page. Saves the signed copy to the po-documents bucket
//   (deterministic path — redo overwrites) and attaches it to the DN in
//   ERPNext as a permanent record.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/

async function guardAny(req: NextRequest) {
  let guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) guard = await requireMenuAccess(req, '/shipping-overview')
  if (!guard.ok) guard = await requireMenuAccess(req, '/po-automation')
  return guard
}

export async function GET(req: NextRequest) {
  const guard = await guardAny(req)
  if (!guard.ok) return guard.res

  const dn = req.nextUrl.searchParams.get('dn')?.trim() ?? ''
  if (!DN_NAME.test(dn)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const raw = req.nextUrl.searchParams.get('raw') === '1'
  const forceOriginal = req.nextUrl.searchParams.get('original') === '1'

  try {
    const ref = await resolveDnShipment(dn)
    if (!ref) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

    if (!raw) {
      const state = await getExternalBolState(ref)
      return NextResponse.json(
        {
          exists: !!state.original,
          signed: !!state.signedPath,
          source: state.original?.kind ?? null,
          fileName: state.original?.fileName ?? null,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    // crew-chosen additional clockwise view rotation (placement preview only)
    const rot = Number(req.nextUrl.searchParams.get('rot') ?? '0')
    if (![0, 90, 180, 270].includes(rot)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    let bytes: Uint8Array | null = null
    let sourceKey: string | null = null
    if (forceOriginal) {
      const original = await fetchOriginalExternalBol(ref)
      bytes = original ? await externalBolToPdf(original.bytes, original.contentType) : null
      if (bytes) bytes = await normalizeExternalPdf(bytes, rot)
      sourceKey = original?.sourceKey ?? null
    } else {
      bytes = (await fetchExternalBolPdf(ref))?.bytes ?? null
    }
    if (!bytes) return NextResponse.json({ error: 'No external BOL' }, { status: 404 })
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="CustomerBOL-${dn}.pdf"`,
        'Cache-Control': 'no-store',
        // the placement UI echoes this back so a stamp is bound to the exact
        // file version the crew previewed (base64: header must be ASCII-safe)
        ...(sourceKey ? { 'X-Source-Key': Buffer.from(sourceKey).toString('base64') } : {}),
      },
    })
  } catch (error) {
    if (error instanceof ExternalBolUnsupportedError) {
      return NextResponse.json({ error: 'unsupported_format' }, { status: 422 })
    }
    console.error('external-bol GET failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: {
    dn?: string
    page?: unknown
    x?: unknown
    y?: unknown
    w?: unknown
    rot?: unknown
    sourceKey?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  // the exact file version the crew previewed (base64 of X-Source-Key).
  // REQUIRED — an omitted/empty key must never skip the version check, or a
  // stale client could stamp old-preview coordinates onto a replaced file.
  const previewKey =
    typeof body.sourceKey === 'string' && body.sourceKey
      ? Buffer.from(body.sourceKey, 'base64').toString()
      : ''
  const dn = String(body.dn ?? '').trim()
  const pageIndex = Number(body.page)
  const x = Number(body.x)
  const y = Number(body.y)
  const w = Number(body.w)
  const rot = Number(body.rot ?? 0)
  if (
    !DN_NAME.test(dn) ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    !(x >= 0 && x <= 1) ||
    !(y >= 0 && y <= 1) ||
    !(w >= 0.05 && w <= 0.9) ||
    ![0, 90, 180, 270].includes(rot)
  ) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const ref = await resolveDnShipment(dn)
    if (!ref) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

    // The signature comes from the DN itself — the driver must have signed the
    // ship screen's pad first. Never accept caller-supplied image bytes here.
    const doc = await erpnextGetDoc<{
      receiver_signature?: string | null
      custom_driver_name?: string | null
      received_by_name?: string | null
      custom_signed_at?: string | null
    }>('Delivery Note', dn)
    const sigDataUrl = doc.receiver_signature ?? ''
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sigDataUrl)
    if (!m) return NextResponse.json({ error: 'not_signed' }, { status: 409 })
    const sigBytes = Buffer.from(m[1], 'base64')

    const original = await fetchOriginalExternalBol(ref)
    if (!original) return NextResponse.json({ error: 'No external BOL' }, { status: 404 })
    // the coordinates were chosen on the previewed file — refuse to stamp a
    // DIFFERENT file (replaced since preview, or no key at all) at those
    // coordinates; the comparison is unconditional
    if (previewKey !== original.sourceKey) {
      return NextResponse.json({ error: 'source_changed' }, { status: 409 })
    }
    // Bake the crew's chosen rotation (plus any inherent /Rotate) into the
    // content — the SAME transform the preview was served with, so the tap
    // coordinates line up 1:1 and the saved copy reads upright.
    const pdfBytes = await normalizeExternalPdf(
      await externalBolToPdf(original.bytes, original.contentType),
      rot
    )

    const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
    const pages = pdf.getPages()
    if (pageIndex >= pages.length) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const page = pages[pageIndex]
    // normalized pages are rotation-0 with CropBox at origin
    const box = page.getCropBox()
    const sig = await pdf.embedPng(sigBytes)
    const boxW = w * box.width
    const sigH = boxW * (sig.height / sig.width)
    const drawX = box.x + Math.min(x * box.width, box.width - boxW)
    // UI y = top-left from the page TOP; PDF origin is bottom-left
    const drawY = box.y + Math.max(box.height - y * box.height - sigH, 12)
    page.drawImage(sig, { x: drawX, y: drawY, width: boxW, height: sigH })

    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const who = (doc.custom_driver_name || doc.received_by_name || '').trim()
    const when = (doc.custom_signed_at || '').slice(0, 16)
    const caption = [who, when].filter(Boolean).join(' — ')
    if (caption) {
      page.drawText(caption, {
        x: drawX,
        y: Math.max(drawY - 10, 2),
        size: 7,
        font,
        color: rgb(0.1, 0.1, 0.35),
      })
    }

    const out = await pdf.save()
    // upload the new signed copy first, then remove the previous one(s) — a
    // redo never leaves a window with no signed copy, and exactly one remains
    // PER TRUCK: reads are truck-scoped, so cleanup sweeps every member DN or
    // a re-sign from a different member would leave divergent signed copies
    const sibDns = await truckloadMemberDns(dn)
    const previous = (await Promise.all([dn, ...sibDns].map((d) => findSignedBolObjects(d)))).flat()
    const signedPath = newSignedBolPath(dn)
    const { error: upErr } = await supabaseAdmin.storage
      .from(PO_DOC_BUCKET)
      .upload(signedPath, Buffer.from(out), { contentType: 'application/pdf' })
    if (upErr) throw new Error(upErr.message)

    // Atomic-enough recheck: if the source file was swapped while we were
    // stamping (concurrent replace/delete), the copy we just published was
    // made from stale bytes — withdraw it and tell the crew to redo.
    const nowSource = await resolveOriginalSource(ref).catch(() => null)
    if (nowSource?.sourceKey !== original.sourceKey) {
      await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([signedPath])
      return NextResponse.json({ error: 'source_changed' }, { status: 409 })
    }

    if (previous.length) {
      const { error: rmErr } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove(previous.map((o) => o.path))
      if (rmErr) console.error('previous signed BOL cleanup failed:', dn, rmErr.message)
    }

    // Permanent record next to our own BOL on the Delivery Note (best-effort:
    // the signed copy in storage is already the print source).
    try {
      await erpnextUploadFile({
        fileName: `SignedCustomerBOL-${dn}-${Date.now()}.pdf`,
        bytes: out,
        attachedToDoctype: 'Delivery Note',
        attachedToName: dn,
        contentType: 'application/pdf',
      })
    } catch (e) {
      console.error('signed external BOL ERPNext attach failed:', e)
    }

    logFulfillment({
      action: 'sign_external_bol',
      so: ref.so,
      dn,
      customer: ref.customer,
      userId: guard.userId,
      detail: caption || null,
    })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ExternalBolUnsupportedError) {
      return NextResponse.json({ error: 'unsupported_format' }, { status: 422 })
    }
    console.error('external-bol sign failed:', error)
    return NextResponse.json({ error: 'Could not stamp the signature. Try again.' }, { status: 502 })
  }
}
