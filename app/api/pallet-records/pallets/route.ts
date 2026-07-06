import { NextRequest, NextResponse } from 'next/server'
import { actorId, actorName, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  appendPalletRecord,
  getCustomerByLine,
  markPalletDeletedInSheet,
  revertMainDataStatusAfterPalletDelete,
  updatePalletRecordInSheet,
} from '@/lib/pallets/google'

export const dynamic = 'force-dynamic'

function nullableValue(value: unknown) {
  return value === '' || value === undefined ? null : value
}

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { searchParams } = new URL(request.url)
    const lineNumber = searchParams.get('line_number')
    if (!lineNumber) {
      return NextResponse.json({ error: 'line_number required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('pallet_records')
      .select('*')
      .eq('line_number', lineNumber)
      .order('pallet_number', { ascending: true })

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Pallets GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch pallets' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const body = await request.json()
    const { line_number, pallet_number, weight, parts_per_pallet, length, width, height, photo_urls } = body

    if (!line_number || !pallet_number) {
      return NextResponse.json({ error: 'line_number and pallet_number required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const recordedBy = actorId(actor)
    const recordedByName = actorName(actor)
    const customer = await getCustomerByLine(line_number)

    // Idempotency guard: a double-tap / offline-retry on the floor was inserting
    // the SAME pallet twice, inflating the pallet count (Simon 2026-07-06 — one
    // photo recorded as two pallets). If a record for this line already exists
    // with the same pallet_number AND the same photo set, return it instead of
    // creating a duplicate. Distinct photos (a genuine re-shoot) still create a
    // new record, so real pallets are never blocked.
    const incomingPhotos = Array.isArray(photo_urls) ? [...photo_urls].sort() : []
    const { data: existingForLine } = await supabaseAdmin
      .from('pallet_records')
      .select('*')
      .eq('line_number', line_number)
      .eq('pallet_number', pallet_number)
    const dupe = (existingForLine ?? []).find((r) => {
      const have = Array.isArray(r.photo_urls) ? [...r.photo_urls].sort() : []
      const samePhotos =
        have.length === incomingPhotos.length && have.every((u, i) => u === incomingPhotos[i])
      // same pallet# + identical photos = the reported double-submit; also catch
      // the rapid empty-photo double-tap (same pallet# created <60s ago).
      const rapidRepeat =
        incomingPhotos.length === 0 &&
        Date.now() - new Date(r.created_at).getTime() < 60_000
      return samePhotos || rapidRepeat
    })
    if (dupe) {
      return NextResponse.json(dupe, { headers: { 'X-Deduped': '1' } })
    }

    const { data, error } = await supabaseAdmin
      .from('pallet_records')
      .insert({
        line_number,
        pallet_number,
        weight: nullableValue(weight),
        parts_per_pallet: nullableValue(parts_per_pallet),
        length: nullableValue(length),
        width: nullableValue(width),
        height: nullableValue(height),
        photo_urls: photo_urls || [],
        recorded_by: recordedBy,
        recorded_by_name: recordedByName,
        created_at: now,
      })
      .select()
      .single()

    if (error) throw error

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'pallet',
        record_id: data.id,
        action: 'create',
        old_data: null,
        new_data: data,
        changed_by: recordedBy,
        changed_by_name: recordedByName,
        created_at: now,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    try {
      await appendPalletRecord({
        now,
        line_number,
        pallet_number,
        weight,
        parts_per_pallet,
        length,
        width,
        height,
        photo_urls: photo_urls || [],
        recorded_by: recordedBy,
        recorded_by_name: recordedByName,
        customer,
      })
    } catch (sheetError) {
      console.error('Sheet sync error (non-fatal):', sheetError)
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Pallets POST error:', error)
    return NextResponse.json({ error: 'Failed to save pallet' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const body = await request.json()
    const { id, weight, parts_per_pallet, length, width, height, photo_urls } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const now = new Date().toISOString()
    const editedBy = actorId(actor)
    const editedByName = actorName(actor)

    const { data: oldRecord } = await supabaseAdmin
      .from('pallet_records')
      .select('*')
      .eq('id', id)
      .single()

    if (!oldRecord) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    const { data, error } = await supabaseAdmin
      .from('pallet_records')
      .update({
        weight: nullableValue(weight),
        parts_per_pallet: nullableValue(parts_per_pallet),
        length: nullableValue(length),
        width: nullableValue(width),
        height: nullableValue(height),
        photo_urls: photo_urls || [],
        edited_by: editedBy,
        edited_by_name: editedByName,
        edited_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'pallet',
        record_id: id,
        action: 'edit',
        old_data: oldRecord,
        new_data: data,
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
        weight,
        parts_per_pallet,
        length,
        width,
        height,
        photo_urls: photo_urls || [],
        edited_by: editedBy,
        edited_by_name: editedByName,
      })
    } catch (sheetError) {
      console.error('Sheet update error (non-fatal):', sheetError)
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Pallets PUT error:', error)
    return NextResponse.json({ error: 'Failed to update pallet' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const now = new Date().toISOString()
    const deletedBy = actorId(actor)
    const deletedByName = actorName(actor)

    const { data: record } = await supabaseAdmin
      .from('pallet_records')
      .select('*')
      .eq('id', id)
      .single()

    if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    const { error } = await supabaseAdmin
      .from('pallet_records')
      .delete()
      .eq('id', id)

    if (error) throw error

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'pallet',
        record_id: id,
        action: 'delete',
        old_data: record,
        new_data: null,
        changed_by: deletedBy,
        changed_by_name: deletedByName,
        created_at: now,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    try {
      await markPalletDeletedInSheet({
        now,
        line_number: record.line_number,
        pallet_number: record.pallet_number,
        deleted_by: deletedBy,
        deleted_by_name: deletedByName,
      })
    } catch (sheetError) {
      console.error('Sheet delete error (non-fatal):', sheetError)
    }

    try {
      const { count } = await supabaseAdmin
        .from('pallet_records')
        .select('*', { count: 'exact', head: true })
        .eq('line_number', record.line_number)
      await revertMainDataStatusAfterPalletDelete(record.line_number, count ?? 0)
    } catch (statusError) {
      console.error('Status revert check error (non-fatal):', statusError)
    }

    return NextResponse.json({ ok: true, line_number: record.line_number })
  } catch (error) {
    console.error('Pallets DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete pallet' }, { status: 500 })
  }
}
