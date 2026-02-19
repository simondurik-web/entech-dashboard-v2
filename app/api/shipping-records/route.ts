import { NextResponse } from 'next/server'
import { fetchShippingRecords, type ShippingRecord } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    // Fetch from BOTH sources in parallel
    const [sheetRecords, dbResult] = await Promise.all([
      fetchShippingRecords(),
      supabaseAdmin.from('shipping_records').select('*').order('created_at', { ascending: false }),
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

    return NextResponse.json([...resolvedSheet, ...dbRecords])
  } catch (error) {
    console.error('Failed to fetch shipping records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping records' },
      { status: 500 }
    )
  }
}
