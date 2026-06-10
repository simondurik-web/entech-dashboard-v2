import { NextResponse } from 'next/server'
import { actorEmail, actorName, adminOnly, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
  const editedBy = actorEmail(actor)
  const editedByName = actorName(actor)

  for (const u of updates) {
    const { id, ...fields } = u
    if (!id) {
      errors.push({ id: '', error: 'id required' })
      continue
    }
    const { error } = await supabaseAdmin
      .from('pallet_records')
      .update({ ...fields, edited_by: editedBy, edited_by_name: editedByName, edited_at: now })
      .eq('id', id)
    if (error) errors.push({ id, error: error.message })
  }

  if (errors.length > 0) return NextResponse.json({ errors }, { status: 207 })
  return NextResponse.json({ success: true })
}
