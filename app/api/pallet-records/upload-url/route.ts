import { NextRequest, NextResponse } from 'next/server'
import { forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

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

function extensionFromMime(mimeType: string) {
  return EXT_BY_MIME[mimeType.toLowerCase()]
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { if_number, pallet_number, content_type } = await request.json()
    if (!if_number || !pallet_number || !content_type) {
      return NextResponse.json({ error: 'Missing if_number, pallet_number, or content_type' }, { status: 400 })
    }
    if (!safePathSegment(if_number) || !safePathSegment(pallet_number)) {
      return NextResponse.json({ error: 'Invalid if_number or pallet_number' }, { status: 400 })
    }

    const ext = extensionFromMime(content_type)
    if (!ext) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
    }
    const path = `${if_number}/pallet-${pallet_number}/${Date.now()}.${ext}`

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)

    if (error) {
      console.error('Signed URL error:', error)
      return NextResponse.json({ error: 'Failed to create upload URL', detail: error.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path,
      publicUrl: urlData.publicUrl,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Upload URL error:', msg)
    return NextResponse.json({ error: 'Failed', detail: msg }, { status: 500 })
  }
}
