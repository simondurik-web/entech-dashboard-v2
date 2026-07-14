import { NextRequest, NextResponse } from 'next/server'
import { actorId, actorName, adminOnly, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  const { searchParams } = new URL(request.url)
  const recordId = searchParams.get('record_id')
  const recordType = searchParams.get('record_type') || 'pallet'
  const limit = parseInt(searchParams.get('limit') || '50', 10)

  let query = supabaseAdmin
    .from('audit_trail')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (recordType !== 'all') query = query.eq('record_type', recordType)
  if (recordId) query = query.eq('record_id', recordId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { audit_id, restore_photos, restore_full } = await request.json()

    if (!audit_id || (!restore_photos && !restore_full)) {
      return NextResponse.json({ error: 'audit_id and (restore_photos or restore_full) required' }, { status: 400 })
    }

    const { data: auditRecord } = await supabaseAdmin
      .from('audit_trail')
      .select('*')
      .eq('id', audit_id)
      .single()

    if (!auditRecord) return NextResponse.json({ error: 'Audit record not found' }, { status: 404 })

    const editedBy = actorId(actor)
    const editedByName = actorName(actor)

    if (restore_full) {
      if (auditRecord.action !== 'delete') {
        return NextResponse.json({ error: 'restore_full only valid on delete audit entries' }, { status: 400 })
      }
      if (!auditRecord.old_data) {
        return NextResponse.json({ error: 'Audit entry has no old_data to restore from' }, { status: 400 })
      }

      const table = auditRecord.record_type === 'shipping' ? 'shipping_records'
        : auditRecord.record_type === 'pallet' ? 'pallet_records'
          : null
      if (!table) {
        return NextResponse.json({ error: `Unsupported record_type: ${auditRecord.record_type}` }, { status: 400 })
      }

      const { data: priorRestore } = await supabaseAdmin
        .from('audit_trail')
        .select('id, record_id')
        .eq('record_type', auditRecord.record_type)
        .eq('action', 'restore')
        .contains('new_data', { __restored_from_audit: audit_id })
        .limit(1)
        .maybeSingle()

      if (priorRestore) {
        return NextResponse.json(
          { error: 'Already restored', existing_record_id: priorRestore.record_id },
          { status: 409 }
        )
      }

      const oldData = auditRecord.old_data as Record<string, unknown>
      const { id: _discardedId, ...rest } = oldData
      void _discardedId
      const now = new Date().toISOString()

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from(table)
        .insert(rest)
        .select()
        .single()

      if (insertError) throw insertError

      try {
        await supabaseAdmin.from('audit_trail').insert({
          record_type: auditRecord.record_type,
          record_id: inserted.id,
          action: 'restore',
          old_data: null,
          new_data: { ...inserted, __restored_from_audit: audit_id },
          changed_by: editedBy,
          changed_by_name: editedByName,
          created_at: now,
        })
      } catch (auditError) {
        console.error('Audit trail error (non-fatal):', auditError)
      }

      return NextResponse.json({ success: true, restored_record: inserted })
    }

    const recordId = auditRecord.record_id
    const oldPhotos: string[] = auditRecord.old_data?.photo_urls || []
    if (oldPhotos.length === 0) {
      return NextResponse.json({ error: 'No photos to restore in this audit entry' }, { status: 400 })
    }

    const { data: currentRecord } = await supabaseAdmin
      .from('pallet_records')
      .select('*')
      .eq('id', recordId)
      .single()

    if (!currentRecord) return NextResponse.json({ error: 'Pallet record not found' }, { status: 404 })

    const now = new Date().toISOString()
    const currentPhotos: string[] = currentRecord.photo_urls || []
    const restoredPhotos = [...currentPhotos]
    for (const photo of oldPhotos) {
      if (photo && !restoredPhotos.includes(photo)) {
        const emptyIdx = restoredPhotos.findIndex((p) => !p)
        if (emptyIdx >= 0) restoredPhotos[emptyIdx] = photo
        else if (restoredPhotos.length < 15) restoredPhotos.push(photo)
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('pallet_records')
      .update({
        photo_urls: restoredPhotos,
        edited_by: editedBy,
        edited_by_name: editedByName,
        edited_at: now,
      })
      .eq('id', recordId)
      .select()
      .single()

    if (updateError) throw updateError

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'pallet',
        record_id: recordId,
        action: 'photo_restore',
        old_data: currentRecord,
        new_data: updated,
        changed_by: editedBy,
        changed_by_name: editedByName,
        created_at: now,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    return NextResponse.json({ success: true, restored_photos: restoredPhotos })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
