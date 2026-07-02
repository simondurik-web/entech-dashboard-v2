import { NextRequest, NextResponse } from 'next/server'
import { actorId, actorName, adminOnly, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Admin-only "Force to Shipping" override for the pallet-photo gate. Writing a
// row here moves a Staged order to Shipping even though not every pallet has
// been photographed; deleting it puts the order back under the gate.

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const body = await request.json().catch(() => ({}))
    const lineNumber = String(body.line_number ?? '').trim()
    if (!lineNumber) {
      return NextResponse.json({ error: 'line_number required' }, { status: 400 })
    }

    const forcedBy = actorId(actor)
    const forcedByName = actorName(actor)

    const { error } = await supabaseAdmin
      .from('pallet_shipping_overrides')
      .upsert(
        {
          line_number: lineNumber,
          forced_by: forcedBy || null,
          forced_by_name: forcedByName || null,
          forced_at: new Date().toISOString(),
        },
        { onConflict: 'line_number' }
      )
    if (error) throw error

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'shipping',
        record_id: lineNumber,
        action: 'force-to-shipping',
        old_data: null,
        new_data: { line_number: lineNumber },
        changed_by: forcedBy,
        changed_by_name: forcedByName,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    return NextResponse.json({ ok: true, line_number: lineNumber })
  } catch (error) {
    console.error('Force-shipping POST error:', error)
    return NextResponse.json({ error: 'Failed to force shipping' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { searchParams } = new URL(request.url)
    const lineNumber = String(searchParams.get('line_number') ?? '').trim()
    if (!lineNumber) {
      return NextResponse.json({ error: 'line_number required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('pallet_shipping_overrides')
      .delete()
      .eq('line_number', lineNumber)
    if (error) throw error

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'shipping',
        record_id: lineNumber,
        action: 'unforce-to-shipping',
        old_data: { line_number: lineNumber },
        new_data: null,
        changed_by: actorId(actor),
        changed_by_name: actorName(actor),
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    return NextResponse.json({ ok: true, line_number: lineNumber })
  } catch (error) {
    console.error('Force-shipping DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove override' }, { status: 500 })
  }
}
