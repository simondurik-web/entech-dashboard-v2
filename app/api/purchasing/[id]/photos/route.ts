import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPurchasing } from '@/lib/purchasing/guard'
import { resolveActor, logPurchasing } from '@/lib/purchasing/audit'
import { PHOTO_BUCKET, MAX_PHOTO_BYTES, PHOTO_KINDS, photoPublicUrl, type PhotoKind } from '@/lib/purchasing/photos'
import { requireReadAccess, requireUser } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

/** GET photos for an order. ?kind=item|paperwork filters; ?includeDeleted=1 includes soft-deleted. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const sp = new URL(req.url).searchParams
  const includeDeleted = sp.get('includeDeleted') === '1'
  const kind = sp.get('kind')

  let q = supabaseAdmin
    .from('purchasing_photos')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: true })
  if (!includeDeleted) q = q.is('deleted_at', null)
  if (kind && PHOTO_KINDS.includes(kind as PhotoKind)) q = q.eq('kind', kind)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const photos = (data ?? []).map((p) => ({ ...p, url: photoPublicUrl(p.storage_path) }))
  return NextResponse.json({ photos })
}

/** POST multipart (field "files") -> upload item photos to storage + rows. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData()
  const kindRaw = String(form.get('kind') || 'item')
  const kind: PhotoKind = PHOTO_KINDS.includes(kindRaw as PhotoKind) ? (kindRaw as PhotoKind) : 'item'
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  // Validate the WHOLE batch up front so we never partially upload then fail.
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (images.length === 0) return NextResponse.json({ error: 'No image files' }, { status: 400 })
  for (const f of images) {
    if (f.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: `File too large (max 15MB): ${f.name}` }, { status: 400 })
  }

  const inserted: Record<string, unknown>[] = []
  for (const file of images) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
    const path = `${id}/${crypto.randomUUID()}.${ext}`
    const buf = Buffer.from(await file.arrayBuffer())
    const up = await supabaseAdmin.storage.from(PHOTO_BUCKET).upload(path, buf, { contentType: file.type || 'image/jpeg', upsert: false })
    if (up.error) return NextResponse.json({ error: up.error.message, photos: inserted }, { status: 500 })
    const { data: row, error } = await supabaseAdmin
      .from('purchasing_photos')
      .insert({ order_id: id, kind, storage_path: path, original_name: file.name.slice(0, 200), uploaded_by: userId })
      .select()
      .single()
    if (error) {
      // Don't leave an orphaned object in the bucket.
      await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path])
      return NextResponse.json({ error: error.message, photos: inserted }, { status: 500 })
    }
    inserted.push({ ...row, url: photoPublicUrl(path) })
  }

  if (inserted.length > 0) {
    const { data: order } = await supabaseAdmin.from('purchasing_orders').select('item_description').eq('id', id).single()
    const actor = await resolveActor(userId)
    await logPurchasing(actor, [{
      order_id: id,
      item_description: order?.item_description ?? null,
      action: 'updated',
      field_name: kind === 'paperwork' ? 'Paperwork picture' : 'Item picture',
      old_value: null,
      new_value: `added ${inserted.length} photo(s)`,
    }])
  }

  return NextResponse.json({ photos: inserted })
}
