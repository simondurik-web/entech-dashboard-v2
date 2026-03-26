import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/** POST — Recover a deleted pallet record from audit trail */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const userName = body.recovered_by_name || 'Unknown'

  // Find the deletion audit entry with the full record snapshot
  const { data: auditEntry, error: auditErr } = await supabaseAdmin
    .from('pallet_record_audit')
    .select('*')
    .eq('pallet_record_id', id)
    .eq('action', 'deleted')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (auditErr || !auditEntry?.old_value) {
    return NextResponse.json({ error: 'No deleted record found to recover' }, { status: 404 })
  }

  // Parse the archived record
  let archived: Record<string, unknown>
  try {
    archived = JSON.parse(auditEntry.old_value)
  } catch {
    return NextResponse.json({ error: 'Failed to parse archived record' }, { status: 500 })
  }

  // Re-insert with the same ID
  const { data, error } = await supabaseAdmin
    .from('pallet_records')
    .insert({
      id: archived.id,
      line_number: archived.line_number,
      order_id: archived.order_id,
      pallet_number: archived.pallet_number,
      weight: archived.weight,
      length: archived.length,
      width: archived.width,
      height: archived.height,
      parts_per_pallet: archived.parts_per_pallet,
      photo_urls: archived.photo_urls || [],
      shipment_photo_urls: archived.shipment_photo_urls || [],
      work_paper_photo_urls: archived.work_paper_photo_urls || [],
      recorded_by: archived.recorded_by || null,
      recorded_by_name: archived.recorded_by_name,
      edited_by: null,
      edited_by_name: userName,
      edited_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log recovery in audit
  await supabaseAdmin.from('pallet_record_audit').insert({
    pallet_record_id: id,
    action: 'recovered',
    field_name: null,
    old_value: null,
    new_value: `Recovered by ${userName}`,
    performed_by_name: userName,
  })

  return NextResponse.json(data)
}
