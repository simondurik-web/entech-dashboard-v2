import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { calculatePackages, generateQrData, validateLabelData } from '@/lib/label-utils'
import { requireUserOrDevice } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const orderLine = searchParams.get('order_line')

  let query = supabaseAdmin
    .from('labels')
    .select('*')
    .order('created_at', { ascending: false })

  if (status) query = query.eq('label_status', status)
  if (orderLine) query = query.eq('order_line', orderLine)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { order_lines, custom_parts_per_package, custom_packaging_type } = body as {
    order_lines: string[]
    custom_parts_per_package?: Record<string, number>
    custom_packaging_type?: Record<string, string>
  }

  if (!order_lines?.length) {
    return NextResponse.json({ error: 'order_lines array is required' }, { status: 400 })
  }

  const actor = await requireUserOrDevice(req)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = actor.id
  const results: Array<{ order_line: string; labels?: unknown[]; error?: string }> = []

  for (const orderLine of order_lines) {
    // Look up order data
    const { data: order } = await supabaseAdmin
      .from('dashboard_orders')
      .select('*')
      .eq('line', orderLine)
      .single()

    if (!order) {
      results.push({ order_line: orderLine, error: 'Order not found' })
      continue
    }

    const customerName = order.customer || order.customer_name || ''
    const partNumber = order.part_number || order.partNumber || ''
    const orderQty = Number(order.order_qty || order.orderQty || 0)
    let partsPerPackage = Number(order.parts_per_package || order.partsPerPackage || 0)

    // Apply custom parts_per_package override if provided
    if (custom_parts_per_package?.[orderLine]) {
      partsPerPackage = custom_parts_per_package[orderLine]
    }

    // Fallback: pull the standard pack qty from the customer's part mapping.
    // customer_part_mappings is keyed by (customer_id, internal_part_number) and the
    // quantity lives in package_quantity — NOT part_number/parts_per_package, so the
    // previous lookup never matched (and .single() threw on 0/many rows).
    if (partsPerPackage <= 0 && customerName && partNumber) {
      const { data: cust } = await supabaseAdmin
        .from('customers')
        .select('id')
        .ilike('name', customerName.trim())
        .maybeSingle()
      if (cust?.id) {
        const { data: mapping } = await supabaseAdmin
          .from('customer_part_mappings')
          .select('package_quantity')
          .eq('customer_id', cust.id)
          .eq('internal_part_number', partNumber)
          .maybeSingle()
        if (mapping?.package_quantity) {
          partsPerPackage = Number(mapping.package_quantity)
        }
      }
    }

    const validation = validateLabelData({
      order_line: orderLine,
      customer_name: customerName,
      part_number: partNumber,
      order_qty: orderQty,
      parts_per_package: partsPerPackage,
    })

    if (!validation.valid) {
      results.push({ order_line: orderLine, error: validation.errors.join(', ') })
      continue
    }

    // Apply custom packaging_type override if provided; empty string clears to null
    const customPackaging = custom_packaging_type?.[orderLine]
    const effectivePackagingType =
      customPackaging !== undefined
        ? (customPackaging.trim() || null)
        : (order.packaging || order.packaging_type || null)

    const { numPackages, lastPackageQty } = calculatePackages(orderQty, partsPerPackage)
    const qrData = generateQrData(orderLine, customerName, partNumber, undefined, numPackages)

    // Check if labels already exist — skip duplicate check (caller handles delete for regenerate)
    const { data: existing } = await supabaseAdmin
      .from('labels')
      .select('id')
      .eq('order_line', orderLine)

    if (existing && existing.length > 0) {
      results.push({ order_line: orderLine, error: 'Labels already exist for this order line. Delete first to regenerate.' })
      continue
    }

    // Insert one label per pallet — each gets a unique QR code
    const palletRows = Array.from({ length: numPackages }, (_, i) => {
      const palletNum = i + 1
      const partsInThis = palletNum === numPackages ? lastPackageQty : partsPerPackage
      return {
        order_line: orderLine,
        customer_name: customerName,
        part_number: partNumber,
        order_qty: orderQty,
        parts_per_package: partsInThis,
        num_packages: numPackages,
        pallet_number: palletNum,
        packaging_type: effectivePackagingType,
        qr_data: generateQrData(orderLine, customerName, partNumber, palletNum, numPackages),
        label_status: 'generated' as const,
        tire: order.tire || null,
        hub: order.hub || null,
        hub_style: order.hub_style || order.hub_mold || null,
        bearings: order.bearings || null,
        po_number: order.po_number || null,
        if_number: order.if_number || null,
        assigned_to: order.assigned_to || order.assignedTo || null,
        generated_by: userId || null,
        generated_at: new Date().toISOString(),
      }
    })

    const { data: labels, error } = await supabaseAdmin
      .from('labels')
      .insert(palletRows)
      .select()

    if (error) {
      results.push({ order_line: orderLine, error: error.message })
      continue
    }

    if (labels?.length) {
      const customFlags = [
        custom_parts_per_package?.[orderLine] ? 'custom parts/pkg' : null,
        customPackaging !== undefined ? `custom packaging: ${effectivePackagingType ?? 'none'}` : null,
      ].filter(Boolean)
      const customNote = customFlags.length ? ` (${customFlags.join(', ')})` : ''
      await supabaseAdmin.from('label_activity_log').insert({
        label_id: labels[0].id,
        order_line: orderLine,
        action: 'generated',
        status: 'success',
        notes: `Generated ${numPackages} pallet labels (last pallet: ${lastPackageQty} parts)${customNote}`,
        created_by: userId || null,
      })

      await supabaseAdmin
        .from('dashboard_orders')
        .update({ label_status: 'generated' })
        .eq('line', orderLine)
    }

    results.push({ order_line: orderLine, labels })
  }

  return NextResponse.json({ results })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const orderLine = searchParams.get('order_line')

  if (!orderLine) {
    return NextResponse.json({ error: 'order_line query parameter is required' }, { status: 400 })
  }

  const actor = await requireUserOrDevice(req)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = actor.id

  // Log the deletion
  const { data: existing } = await supabaseAdmin
    .from('labels')
    .select('id, order_line')
    .eq('order_line', orderLine)

  if (existing && existing.length > 0) {
    for (const label of existing) {
      await supabaseAdmin.from('label_activity_log').insert({
        label_id: label.id,
        order_line: label.order_line,
        action: 'deleted',
        status: 'success',
        notes: 'Deleted for regeneration',
        created_by: userId || null,
      })
    }
  }

  const { error } = await supabaseAdmin
    .from('labels')
    .delete()
    .eq('order_line', orderLine)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
