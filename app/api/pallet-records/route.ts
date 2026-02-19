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

    // Convert Supabase pallet_records to same shape as sheet records
    const dbRecords: PalletRecord[] = (dbResult.data ?? []).map((r) => ({
      timestamp: r.created_at || '',
      orderNumber: r.line_number || '',
      lineNumber: r.line_number || '',
      palletNumber: String(r.pallet_number || ''),
      customer: '',
      ifNumber: r.order_id?.replace(/^IF/i, '') ? `IF${r.order_id.replace(/^IF/i, '')}` : '',
      category: '',
      weight: String(r.weight || ''),
      dimensions: r.length && r.width && r.height ? `${r.length}x${r.width}x${r.height}` : '',
      partsPerPallet: String(r.parts_per_pallet || ''),
      photos: r.photo_urls || [],
      _source: 'app' as const,
    }))

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
