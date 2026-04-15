import { NextResponse } from 'next/server'
import { fetchPalletRecords, type PalletRecord } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    // Fetch from BOTH sources in parallel
    const [sheetRecords, dbResult] = await Promise.all([
      fetchPalletRecords(),
      supabaseAdmin.from('pallet_records').select('*').order('created_at', { ascending: false }),
    ])

    // Resolve legacy Drive URLs → Supabase Storage URLs
    const resolvedSheet = await resolveRecordPhotos(sheetRecords, ['photos'])

    // Enrich app records with customer/category from dashboard_orders by line number
    const dbData = dbResult.data ?? []
    const lineNumbers = [...new Set(dbData.map((r: any) => r.line_number).filter(Boolean))]
    let orderLookup = new Map<string, { customer: string; ifNumber: string; category: string }>()
    if (lineNumbers.length > 0) {
      const { data: orderRows } = await supabaseAdmin
        .from('dashboard_orders')
        .select('line,customer,if_number,category')
        .in('line', lineNumbers)
      if (orderRows) {
        for (const o of orderRows) {
          if (o.line) {
            orderLookup.set(String(o.line), {
              customer: o.customer || '',
              ifNumber: o.if_number || '',
              category: o.category || '',
            })
          }
        }
      }
    }

    // Convert Supabase pallet_records to same shape as sheet records
    const dbRecords: PalletRecord[] = dbData.map((r: any) => {
      const orderInfo = r.line_number ? orderLookup.get(String(r.line_number)) : null
      return {
        id: r.id,
        timestamp: r.created_at || '',
        orderNumber: r.line_number || '',
        lineNumber: r.line_number || '',
        palletNumber: String(r.pallet_number || ''),
        customer: orderInfo?.customer || '',
        ifNumber: orderInfo?.ifNumber || (r.order_id?.replace(/^IF/i, '') ? `IF${r.order_id.replace(/^IF/i, '')}` : ''),
        category: orderInfo?.category || '',
        weight: String(r.weight || ''),
        dimensions: r.length && r.width && r.height ? `${r.length}x${r.width}x${r.height}` : '',
        partsPerPallet: String(r.parts_per_pallet || ''),
        photos: r.photo_urls || [],
        shipmentPhotos: r.shipment_photo_urls || [],
        workPaperPhotos: r.work_paper_photo_urls || [],
        _source: 'app' as const,
        length: r.length,
        width: r.width,
        height: r.height,
        order_id: r.order_id,
        edited_by_name: r.edited_by_name || undefined,
        edited_at: r.edited_at || undefined,
      }
    })

    // Merge: sheet records first, then app records
    // Mark sheet records so we can distinguish if needed
    const allRecords = [
      ...resolvedSheet.map((r) => ({ ...r, _source: 'sheet' as const })),
      ...dbRecords,
    ]

    return NextResponse.json(allRecords)
  } catch (error) {
    console.error('Failed to fetch pallet records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pallet records' },
      { status: 500 }
    )
  }
}
