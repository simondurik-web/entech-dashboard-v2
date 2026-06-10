import { NextResponse } from 'next/server'
import { actorId, actorName, adminOnly, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { updatePalletRecordInSheet } from '@/lib/pallets/google'
import { supabaseAdmin } from '@/lib/supabase-admin'

const UPDATABLE_FIELDS = new Set(['weight', 'length', 'width', 'height', 'parts_per_pallet', 'photo_urls'])

export async function PUT(req: Request) {
  const actor = await palletActorFromRequest(req)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  const { updates } = await req.json()
  if (!Array.isArray(updates)) {
    return NextResponse.json({ error: 'Invalid updates' }, { status: 400 })
  }

  const errors: { id: string; error: string }[] = []
  const now = new Date().toISOString()
  const editedBy = actorId(actor)
  const editedByName = actorName(actor)

  for (const u of updates) {
    const { id, ...rawFields } = u
    if (!id) {
      errors.push({ id: '', error: 'id required' })
      continue
    }

    const fields = Object.fromEntries(
      Object.entries(rawFields).filter(([key]) => UPDATABLE_FIELDS.has(key))
    )

    const { data: oldRecord, error: fetchError } = await supabaseAdmin
      .from('pallet_records')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !oldRecord) {
      errors.push({ id, error: fetchError?.message || 'Record not found' })
      continue
    }

    const { data: updated, error } = await supabaseAdmin
      .from('pallet_records')
      .update({ ...fields, edited_by: editedBy, edited_by_name: editedByName, edited_at: now })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      errors.push({ id, error: error.message })
      continue
    }

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'pallet',
        record_id: id,
        action: 'edit',
        old_data: oldRecord,
        new_data: updated,
        changed_by: editedBy,
        changed_by_name: editedByName,
        created_at: now,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    try {
      await updatePalletRecordInSheet({
        now,
        line_number: oldRecord.line_number,
        pallet_number: oldRecord.pallet_number,
        weight: updated.weight,
        parts_per_pallet: updated.parts_per_pallet,
        length: updated.length,
        width: updated.width,
        height: updated.height,
        photo_urls: updated.photo_urls || [],
        edited_by: editedBy,
        edited_by_name: editedByName,
      })
    } catch (sheetError) {
      console.error('Sheet update error (non-fatal):', sheetError)
    }
  }

  if (errors.length > 0) return NextResponse.json({ errors }, { status: 207 })
  return NextResponse.json({ success: true })
}
