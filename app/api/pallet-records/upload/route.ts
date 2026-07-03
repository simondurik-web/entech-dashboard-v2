import { NextRequest, NextResponse } from 'next/server'
import { forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BUCKET = 'pallet-photos'
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
}

function safePathSegment(value: string) {
  return SAFE_PATH_SEGMENT.test(value)
}

// Since the ERP cutover the IF column holds "SO-00023 (IF153070)" — spaces and
// parens broke the storage-path check and pallet photos stopped saving for ERP
// orders (Jaime, 2026-07-03). Use the first token (the SO/IF number itself) as
// the storage folder; legacy "IF153070" values pass through unchanged.
function storageKeyFromIfNumber(value: string): string | null {
  const first = value.trim().split(/\s+/)[0] ?? ''
  return first && SAFE_PATH_SEGMENT.test(first) ? first : null
}

function extensionFromMime(mimeType: string) {
  return EXT_BY_MIME[mimeType.toLowerCase()]
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const ifNumber = formData.get('if_number') as string
    const palletNumber = formData.get('pallet_number') as string

    if (!file || !ifNumber || !palletNumber) {
      return NextResponse.json({ error: 'Missing file, if_number, or pallet_number' }, { status: 400 })
    }
    const ifKey = storageKeyFromIfNumber(ifNumber)
    if (!ifKey || !safePathSegment(palletNumber)) {
      return NextResponse.json({ error: 'Invalid if_number or pallet_number' }, { status: 400 })
    }
    const ext = extensionFromMime(file.type || '')
    if (!ext) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
    }

    const { data: buckets } = await supabaseAdmin.storage.listBuckets()
    if (!buckets?.find((bucket) => bucket.name === BUCKET)) {
      await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
      })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = `${ifKey}/pallet-${palletNumber}/${Date.now()}.${ext}`

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(fileName, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })

    if (error) {
      console.error('Storage upload error:', error)
      return NextResponse.json({ error: 'Upload failed', detail: error.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(data.path)
    return NextResponse.json({ url: urlData.publicUrl, path: data.path })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Upload error:', msg)
    return NextResponse.json({ error: 'Upload failed', detail: msg }, { status: 500 })
  }
}
