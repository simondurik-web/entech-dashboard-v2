import { NextResponse } from 'next/server'
import { fetchShippingRecords, type ShippingRecord } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildOrderDisplayLookup, resolveDisplayOrder } from '@/lib/order-display'

export async function GET() {
  try {
    // Fetch records + the live-order display lookup in parallel
    const [sheetRecords, dbResult, orderLookup] = await Promise.all([
      fetchShippingRecords(),
      supabaseAdmin.from('shipping_records').select('*').order('created_at', { ascending: false }),
      buildOrderDisplayLookup(),
    ])

    // Resolve legacy Drive URLs → Supabase Storage URLs
    const resolvedSheet = await resolveRecordPhotos(sheetRecords, [
      'photos',
      'shipmentPhotos',
      'paperworkPhotos',
      'closeUpPhotos',
    ])

    // Convert Supabase shipping_records to same shape
    const dbRecords: ShippingRecord[] = (dbResult.data ?? []).map((r) => ({
      timestamp: r.created_at || '',
      shipDate: r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
      customer: r.customer || '',
      ifNumber: r.if_number || '',
      lineNumber: r.line_number || '',
      category: '',
      carrier: r.carrier || '',
      bol: '',
      palletCount: 0,
      photos: [],
      shipmentPhotos: r.shipment_photos || [],
      paperworkPhotos: r.paperwork_photos || [],
      closeUpPhotos: r.closeup_photos || [],
    }))

    // Upgrade the displayed IF# → current Sales Order number for any record that maps
    // to a live ERPNext order (DB records by line number, sheet records by embedded IF
    // token). Records with no live match keep their original historical IF#.
    const allRecords = [...resolvedSheet, ...dbRecords]
    for (const r of allRecords) {
      const info = resolveDisplayOrder(orderLookup, (r as ShippingRecord & { lineNumber?: string }).lineNumber, r.ifNumber)
      if (info) {
        r.ifNumber = info.ifNumber || r.ifNumber
        if (!r.customer || !r.customer.trim()) r.customer = info.customer
        if (!r.category || !r.category.trim()) r.category = info.category
      }
    }

    return NextResponse.json(allRecords)
  } catch (error) {
    console.error('Failed to fetch shipping records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping records' },
      { status: 500 }
    )
  }
}
