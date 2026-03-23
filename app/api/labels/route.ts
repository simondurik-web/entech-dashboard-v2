import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { calculatePackages, generateQrData, validateLabelData } from '@/lib/label-utils'

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
  const { order_lines } = body as { order_lines: string[] }

  if (!order_lines?.length) {
    return NextResponse.json({ error: 'order_lines array is required' }, { status: 400 })
  }

  const userId = req.headers.get('x-user-id') || undefined
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

    // Check customer_part_mappings if parts_per_package is missing
    if (partsPerPackage <= 0) {
      const { data: mapping } = await supabaseAdmin
        .from('customer_part_mappings')
        .select('parts_per_package')
        .eq('part_number', partNumber)
        .single()

      if (mapping?.parts_per_package) {
        partsPerPackage = Number(mapping.parts_per_package)
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

    const { numPackages, lastPackageQty } = calculatePackages(orderQty, partsPerPackage)
    const qrData = generateQrData(orderLine, customerName, partNumber)

    // Check if labels already exist for this order line
    const { data: existing } = await supabaseAdmin
      .from('labels')
      .select('id')
      .eq('order_line', orderLine)

    if (existing && existing.length > 0) {
      results.push({ order_line: orderLine, error: 'Labels already exist for this order line' })
      continue
    }

    const { data: labels, error } = await supabaseAdmin
      .from('labels')
      .insert({
        order_line: orderLine,
        customer_name: customerName,
        part_number: partNumber,
        order_qty: orderQty,
        parts_per_package: partsPerPackage,
        num_packages: numPackages,
        packaging_type: order.packaging || order.packaging_type || null,
        qr_data: qrData,
        label_status: 'generated',
        assigned_to: order.assigned_to || order.assignedTo || null,
        generated_by: userId || null,
        generated_at: new Date().toISOString(),
      })
      .select()

    if (error) {
      results.push({ order_line: orderLine, error: error.message })
      continue
    }

    // Log activity
    if (labels?.[0]) {
      await supabaseAdmin.from('label_activity_log').insert({
        label_id: labels[0].id,
        order_line: orderLine,
        action: 'generated',
        status: 'success',
        notes: `Generated label with ${numPackages} packages (last package: ${lastPackageQty} parts)`,
        created_by: userId || null,
      })

      // Update dashboard_orders label_status
      await supabaseAdmin
        .from('dashboard_orders')
        .update({ label_status: 'generated' })
        .eq('line', orderLine)
    }

    results.push({ order_line: orderLine, labels })
  }

  return NextResponse.json({ results })
}
