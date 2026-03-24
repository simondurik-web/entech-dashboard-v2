import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** POST — Upload a photo and append to pallet record */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get current record to know path info
  const { data: record, error: fetchErr } = await supabaseAdmin
    .from('pallet_records')
    .select('order_id, pallet_number, photo_urls')
    .eq('id', id)
    .single()

  if (fetchErr || !record) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.name.split('.').pop() || 'jpg'
  const orderFolder = record.order_id || 'unknown'
  const palletFolder = `pallet-${record.pallet_number || 0}`
  const fileName = `${Date.now()}.${ext}`
  const storagePath = `${orderFolder}/${palletFolder}/${fileName}`

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('pallet-photos')
    .upload(storagePath, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    })

  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('pallet-photos')
    .getPublicUrl(storagePath)

  const publicUrl = urlData.publicUrl
  const updatedPhotos = [...(record.photo_urls || []), publicUrl]

  const { error: updateErr } = await supabaseAdmin
    .from('pallet_records')
    .update({ photo_urls: updatedPhotos, edited_at: new Date().toISOString() })
    .eq('id', id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Audit log
  const uploadedBy = formData.get('uploaded_by_name') as string || 'Unknown'
  await supabaseAdmin.from('pallet_record_audit').insert({
    pallet_record_id: id,
    action: 'photo_added',
    field_name: 'Photos',
    old_value: `${(record.photo_urls || []).length} photos`,
    new_value: `${updatedPhotos.length} photos`,
    performed_by_name: uploadedBy,
  })

  return NextResponse.json({ photo_urls: updatedPhotos, added: publicUrl })
}

/** DELETE — Remove a photo from pallet record */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const { photo_url, deleted_by_name } = body as { photo_url: string; deleted_by_name?: string }

  if (!photo_url) {
    return NextResponse.json({ error: 'photo_url is required' }, { status: 400 })
  }

  // Get current record
  const { data: record, error: fetchErr } = await supabaseAdmin
    .from('pallet_records')
    .select('photo_urls')
    .eq('id', id)
    .single()

  if (fetchErr || !record) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  // Remove from array
  const updatedPhotos = (record.photo_urls || []).filter((u: string) => u !== photo_url)

  const { error: updateErr } = await supabaseAdmin
    .from('pallet_records')
    .update({ photo_urls: updatedPhotos, edited_at: new Date().toISOString() })
    .eq('id', id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Try to delete from storage (extract path from URL)
  try {
    const bucketUrl = '/storage/v1/object/public/pallet-photos/'
    const idx = photo_url.indexOf(bucketUrl)
    if (idx !== -1) {
      const storagePath = photo_url.slice(idx + bucketUrl.length)
      await supabaseAdmin.storage.from('pallet-photos').remove([storagePath])
    }
  } catch {
    // Storage delete is best-effort
  }

  // Audit log
  await supabaseAdmin.from('pallet_record_audit').insert({
    pallet_record_id: id,
    action: 'photo_deleted',
    field_name: 'Photos',
    old_value: `${(record.photo_urls || []).length} photos`,
    new_value: `${updatedPhotos.length} photos`,
    performed_by_name: deleted_by_name || 'Unknown',
  })

  return NextResponse.json({ photo_urls: updatedPhotos })
}
