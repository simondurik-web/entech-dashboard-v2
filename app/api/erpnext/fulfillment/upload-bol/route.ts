import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextGetDoc, erpnextUploadFile } from '@/lib/erpnext/client'

// POST /api/erpnext/fulfillment/upload-bol  (multipart: dn, file)
// Attaches a customer-provided BOL (outside trucker paperwork) to the shipped
// Delivery Note. This closes the 2026-06-26 bypass gap: when the customer
// sends their own BOL, it now lives on the DN next to ours instead of on
// paper only. PDF or photo, 15 MB cap.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/
const MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }
  const dn = String(form.get('dn') ?? '').trim()
  const file = form.get('file')
  if (!DN_NAME.test(dn) || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 15 MB)' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only PDF or photos are accepted' }, { status: 400 })
  }

  try {
    const doc = await erpnextGetDoc<{ docstatus: number }>('Delivery Note', dn)
    if (doc.docstatus !== 1) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
    const safeExt = /^\.[A-Za-z0-9]{1,5}$/.test(ext) ? ext : ''
    const fileName = `CustomerBOL-${dn}-${Date.now()}${safeExt}`
    await erpnextUploadFile({
      fileName,
      bytes: await file.arrayBuffer(),
      attachedToDoctype: 'Delivery Note',
      attachedToName: dn,
    })
    return NextResponse.json({ fileName }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('customer BOL upload failed:', error)
    return NextResponse.json({ error: 'Upload failed. Try again.' }, { status: 502 })
  }
}
