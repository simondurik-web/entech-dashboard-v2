import { NextRequest, NextResponse } from 'next/server'
import { actorId, actorName, adminOnly, forbidden, isOwnRecord, isWithinThreeDays } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { appendShippingRecord, markShippingDeletedInSheet } from '@/lib/pallets/google'
import { getStagingGates, isReadyForShipping } from '@/lib/pallets/staging-gate'

export const dynamic = 'force-dynamic'

type ShippingRecord = {
  id: string
  order_id: string | null
  carrier: string | null
  system_type: string | null
  if_number: string | null
  shopify_orders: string | null
  veeqo_orders: string | null
  customer: string | null
  line_number: string | null
  shipment_photos: string[] | null
  paperwork_photos: string[] | null
  closeup_photos: string[] | null
  pallet_photos: string[] | null
  recorded_by: string | null
  recorded_by_name: string | null
  created_at: string
}

async function getStagedOrders() {
  // Staged orders ready to ship — reads dashboard_orders (ERPNext-backed, post-Fusion
  // cutover 2026-06-30), NOT the frozen Google Sheet. An order is "staged" when its
  // internal work_order_status is set to 'staged' (populated by the staging feature).
  const { data, error } = await supabaseAdmin
    .from('dashboard_orders')
    .select('line,category,if_number,work_order_status,po_number,customer,order_qty,number_of_packages')
  if (error) throw error

  const staged = (data || [])
    .filter((r) =>
      (r.work_order_status || '').toString().trim().toLowerCase() === 'staged' &&
      (r.if_number || '').toString().trim()
    )
    .map((r, idx) => ({
      id: `staged-${idx}`,
      line_number: String(r.line ?? ''),
      category: r.category || '',
      if_number: r.if_number || '',
      status: 'staged',
      po_number: r.po_number || '',
      customer: r.customer || '',
      order_qty: parseInt(String(r.order_qty ?? ''), 10) || 0,
      num_pallets: parseInt(String(r.number_of_packages ?? ''), 10) || 0,
    }))

  // Pallet-photo gate: a Staged order only shows in Shipping once every
  // expected pallet has a valid photo (or an admin forced it). Until then it
  // stays in Production so the pallets can be photographed. Mirrors the
  // inverse filter in /api/pallet-records/orders.
  const gates = staged.length ? await getStagingGates(staged.map((o) => o.line_number)) : {}
  return staged.filter((o) => isReadyForShipping(o.num_pallets, gates[o.line_number]))
}

function shippingSheetArgs(record: ShippingRecord, now: string) {
  return {
    now,
    system_type: record.system_type || 'fusion',
    order_id: record.order_id || '',
    carrier: record.carrier || '',
    customer: record.customer || '',
    shipment_photos: record.shipment_photos || [],
    paperwork_photos: record.paperwork_photos || [],
    closeup_photos: record.closeup_photos || [],
    pallet_photos: record.pallet_photos || [],
    recorded_by_name: record.recorded_by_name || '',
    recorded_by: record.recorded_by || '',
    if_number: record.if_number || '',
    shopify_orders: record.shopify_orders || '',
    veeqo_orders: record.veeqo_orders || '',
    line_number: record.line_number || '',
  }
}

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  if (mode === 'records') {
    try {
      const ifFilter = searchParams.get('if_number')
      let query = supabaseAdmin
        .from('shipping_records')
        .select('*')
        .order('created_at', { ascending: false })

      if (ifFilter) query = query.eq('if_number', ifFilter)
      else query = query.limit(100)

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data || [])
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  try {
    return NextResponse.json(await getStagedOrders())
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Shipping GET error:', msg)
    return NextResponse.json({ error: 'Failed to fetch orders', detail: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const body = await request.json()
    const {
      carrier, system_type, if_number, shopify_orders, veeqo_orders, customer,
      line_number, shipment_photos, paperwork_photos, closeup_photos, pallet_photos,
    } = body

    const hasCarrier = !!(carrier && String(carrier).trim())
    const hasPalletPhotos = Array.isArray(pallet_photos) && pallet_photos.length > 0

    if (!hasCarrier && !hasPalletPhotos) {
      return NextResponse.json(
        { error: 'Either carrier (for shipment) or pallet_photos (for pre-shipment) required' },
        { status: 400 }
      )
    }

    const effectiveSystem = system_type || 'fusion'
    const hasAnyIdentifier = !!(
      (if_number && String(if_number).trim()) ||
      (shopify_orders && String(shopify_orders).trim()) ||
      (veeqo_orders && String(veeqo_orders).trim()) ||
      (effectiveSystem === 'other' && customer && String(customer).trim())
    )
    if (!hasAnyIdentifier) {
      return NextResponse.json(
        { error: 'At least one of if_number / shopify_orders / veeqo_orders / (other + customer) required' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const recordedBy = actorId(actor)
    const recordedByName = actorName(actor)
    const effectiveOrderId =
      (if_number && String(if_number).trim()) ? if_number :
        effectiveSystem === 'shopify' ? shopify_orders :
          effectiveSystem === 'veeqo' ? veeqo_orders :
            `other-${customer}-${Date.now()}`

    if (!hasCarrier && hasPalletPhotos && if_number && String(if_number).trim()) {
      const { data: existingDraft } = await supabaseAdmin
        .from('shipping_records')
        .select('*')
        .eq('if_number', if_number)
        .is('carrier', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingDraft) {
        const mergedPalletPhotos = Array.from(new Set([
          ...(Array.isArray(existingDraft.pallet_photos) ? existingDraft.pallet_photos : []),
          ...pallet_photos,
        ]))
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('shipping_records')
          .update({
            pallet_photos: mergedPalletPhotos,
            edited_by: recordedBy,
            edited_by_name: recordedByName,
            edited_at: now,
          })
          .eq('id', existingDraft.id)
          .select()
          .single()
        if (updateError) throw updateError
        try {
          await supabaseAdmin.from('audit_trail').insert({
            record_type: 'shipping',
            record_id: existingDraft.id,
            action: 'merge-pallet-photo',
            old_data: existingDraft,
            new_data: updated,
            changed_by: recordedBy,
            changed_by_name: recordedByName,
          })
        } catch (auditError) {
          console.error('Audit trail error (non-fatal):', auditError)
        }
        return NextResponse.json(updated)
      }
    }

    const { data, error } = await supabaseAdmin
      .from('shipping_records')
      .insert({
        order_id: effectiveOrderId,
        carrier: hasCarrier ? carrier : null,
        system_type: effectiveSystem,
        if_number: if_number || null,
        shopify_orders: shopify_orders || null,
        veeqo_orders: veeqo_orders || null,
        customer: customer || null,
        line_number: line_number || null,
        shipment_photos: shipment_photos || [],
        paperwork_photos: paperwork_photos || [],
        closeup_photos: closeup_photos || [],
        pallet_photos: pallet_photos || [],
        recorded_by: recordedBy,
        recorded_by_name: recordedByName,
      })
      .select()

    if (error) throw error

    const inserted = data?.[0] as ShippingRecord | undefined
    if (inserted) {
      try {
        await supabaseAdmin.from('audit_trail').insert({
          record_type: 'shipping',
          record_id: inserted.id,
          action: hasCarrier ? 'create' : 'create-pallet-photo',
          old_data: null,
          new_data: inserted,
          changed_by: recordedBy,
          changed_by_name: recordedByName,
        })
      } catch (auditError) {
        console.error('Audit trail error (non-fatal):', auditError)
      }
    }

    if (hasCarrier && inserted) {
      try {
        await appendShippingRecord(shippingSheetArgs(inserted, now))
      } catch (sheetError) {
        console.error('Sheet append error (non-fatal):', sheetError)
      }
    }

    return NextResponse.json(inserted || {})
  } catch (error) {
    console.error('Shipping POST error:', error)
    return NextResponse.json({ error: 'Failed to save shipping record' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const body = await request.json()
    const {
      id, carrier, customer, order_id, system_type,
      shipment_photos, paperwork_photos, closeup_photos, pallet_photos,
      shopify_orders, veeqo_orders, if_number, line_number,
    } = body

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('shipping_records')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    if (!actor.isAdmin) {
      if (!isOwnRecord(actor, existing)) {
        return NextResponse.json({ error: 'You can only edit your own records' }, { status: 403 })
      }
      if (!isWithinThreeDays(existing.created_at)) {
        return NextResponse.json({ error: 'Edit window expired (3 days)' }, { status: 403 })
      }
    }

    const now = new Date().toISOString()
    const editedBy = actorId(actor)
    const editedByName = actorName(actor)
    const updates: Record<string, unknown> = {
      edited_by: editedBy,
      edited_by_name: editedByName,
      edited_at: now,
    }
    if (carrier !== undefined) updates.carrier = carrier || null
    if (customer !== undefined) updates.customer = customer
    if (order_id !== undefined) updates.order_id = order_id
    if (system_type !== undefined) updates.system_type = system_type
    if (shopify_orders !== undefined) updates.shopify_orders = shopify_orders || null
    if (veeqo_orders !== undefined) updates.veeqo_orders = veeqo_orders || null
    if (if_number !== undefined) updates.if_number = if_number
    if (line_number !== undefined) updates.line_number = line_number
    if (shipment_photos !== undefined) updates.shipment_photos = shipment_photos
    if (paperwork_photos !== undefined) updates.paperwork_photos = paperwork_photos
    if (closeup_photos !== undefined) updates.closeup_photos = closeup_photos
    if (pallet_photos !== undefined) updates.pallet_photos = pallet_photos

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('shipping_records')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'shipping',
        record_id: id,
        action: 'edit',
        old_data: existing,
        new_data: updated,
        changed_by: editedBy,
        changed_by_name: editedByName,
      })
    } catch (auditError) {
      console.error('Audit trail error (non-fatal):', auditError)
    }

    const wasDraft = !existing.carrier || !String(existing.carrier).trim()
    const isNowShipment = !!(updated.carrier && String(updated.carrier).trim())
    if (wasDraft && isNowShipment) {
      try {
        await appendShippingRecord(shippingSheetArgs(updated, now))
      } catch (sheetError) {
        console.error('Sheet append error (non-fatal):', sheetError)
      }
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Shipping PUT error:', error)
    return NextResponse.json({ error: 'Failed to update shipping record' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const now = new Date().toISOString()
    const deletedBy = actorId(actor)
    const deletedByName = actorName(actor)

    const { data: record, error: fetchError } = await supabaseAdmin
      .from('shipping_records')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !record) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    const { error: deleteError } = await supabaseAdmin
      .from('shipping_records')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    try {
      await supabaseAdmin.from('audit_trail').insert({
        record_type: 'shipping',
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
      await markShippingDeletedInSheet(record.order_id || '', record.carrier || '')
    } catch (sheetError) {
      console.error('Sheet delete error (non-fatal):', sheetError)
    }

    return NextResponse.json({ ok: true, id, order_id: record.order_id })
  } catch (error) {
    console.error('Shipping DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete shipping record' }, { status: 500 })
  }
}
