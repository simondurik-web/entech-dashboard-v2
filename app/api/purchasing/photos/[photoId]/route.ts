import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPurchasing } from '@/lib/purchasing/guard'
import { resolveActor, logPurchasing } from '@/lib/purchasing/audit'
import { requireUser } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

async function auditPhoto(userId: string, photo: { order_id: string; original_name: string | null }, verb: string) {
  const { data: order } = await supabaseAdmin.from('purchasing_orders').select('item_description').eq('id', photo.order_id).single()
  const actor = await resolveActor(userId)
  await logPurchasing(actor, [{
    order_id: photo.order_id,
    item_description: order?.item_description ?? null,
    action: 'updated',
    field_name: 'Item picture',
    old_value: verb === 'removed' ? (photo.original_name ?? 'photo') : null,
    new_value: verb === 'removed' ? null : `${verb} ${photo.original_name ?? 'photo'}`,
  }])
}

/** DELETE -> soft-delete (file stays in storage, recoverable via PATCH restore). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: photo } = await supabaseAdmin.from('purchasing_photos').select('order_id, original_name').eq('id', photoId).single()
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('purchasing_photos').update({ deleted_at: new Date().toISOString() }).eq('id', photoId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditPhoto(userId, photo, 'removed')
  return NextResponse.json({ ok: true })
}

/** PATCH { restore: true } -> un-delete a soft-deleted photo. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params
  const userId = (await requireUser(req))?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPurchasing(userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { restore?: boolean }
  if (!body.restore) return NextResponse.json({ error: 'Nothing to do' }, { status: 400 })

  const { data: photo } = await supabaseAdmin.from('purchasing_photos').select('order_id, original_name').eq('id', photoId).single()
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('purchasing_photos').update({ deleted_at: null }).eq('id', photoId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditPhoto(userId, photo, 'restored')
  return NextResponse.json({ ok: true })
}
