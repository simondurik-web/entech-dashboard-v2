import { NextRequest, NextResponse } from 'next/server'
import { actorEmail, actorName, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { appendPalletRecord, getCustomerByLine } from '@/lib/pallets/google'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { line_number } = await request.json()
    if (!line_number) {
      return NextResponse.json({ error: 'line_number required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const recordedBy = actorEmail(actor)
    const recordedByName = actorName(actor)
    const customer = await getCustomerByLine(line_number)

    try {
      await appendPalletRecord({
        now,
        line_number,
        pallet_number: 0,
        weight: '',
        parts_per_pallet: '',
        length: '',
        width: '',
        height: '',
        photo_urls: [],
        recorded_by: recordedBy,
        recorded_by_name: recordedByName,
        customer,
        internal_status: 'STARTED',
      })
    } catch (sheetError) {
      console.error('Sheet write error:', sheetError)
      return NextResponse.json({ error: 'Failed to write to sheet' }, { status: 500 })
    }

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'order_start',
        record_id: `line-${line_number}`,
        action: 'start',
        old_data: null,
        new_data: { line_number, status: 'STARTED', customer },
        changed_by: recordedBy,
        changed_by_name: recordedByName,
        created_at: now,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    return NextResponse.json({ ok: true, status: 'STARTED', line_number })
  } catch (error) {
    console.error('Order start error:', error)
    return NextResponse.json({ error: 'Failed to start order' }, { status: 500 })
  }
}
