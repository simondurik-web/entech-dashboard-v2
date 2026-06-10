import { NextRequest, NextResponse } from 'next/server'
import { forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const BUCKET = 'pallet-photos'

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { if_number, pallet_number, filename } = await request.json()
    if (!if_number || !pallet_number || !filename) {
      return NextResponse.json({ error: 'Missing if_number, pallet_number, or filename' }, { status: 400 })
    }

    const ext = filename.split('.').pop() || 'jpg'
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
