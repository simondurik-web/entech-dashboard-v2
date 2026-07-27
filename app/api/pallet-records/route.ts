import { NextRequest, NextResponse } from 'next/server'
import { fetchPalletRecords, type PalletRecord } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildOrderDisplayLookup, resolveDisplayOrder } from '@/lib/order-display'
import { requireDashboardAccess } from '@/lib/require-user'

// Gated 2026-07-27. This returned ~1.1 MB of customer names, order/IF numbers,
// pallet weights and photo URLs to anonymous callers; verified open against
// production. Enrolled users and approved floor devices only — no external
// consumer of this endpoint exists (searched every script/cron/plist on the
// Mac), so the gate cannot break an integration.
//
// Deliberately requireDashboardAccess and NOT palletActorFromRequest, unlike
// /api/pallet-records/pallets and friends: this flat list feeds general
// dashboard screens (Pallet Photos, Staged, the order detail drawer), not the
// Pallet Records section, so its audience is dashboard users rather than
// production-app members. The two gates differ on purpose — raised by grok in
// the 2026-07-27 review panel, kept as-is with this note.
export async function GET(req: NextRequest) {
  if (!(await requireDashboardAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // Fetch records + the live-order display lookup in parallel
    const [sheetRecords, dbResult, orderLookup] = await Promise.all([
      fetchPalletRecords(),
      supabaseAdmin.from('pallet_records').select('*').order('created_at', { ascending: false }),
      buildOrderDisplayLookup(),
    ])

    // Resolve legacy Drive URLs → Supabase Storage URLs
    const resolvedSheet = await resolveRecordPhotos(sheetRecords, ['photos'])

    const dbData = dbResult.data ?? []

    // Convert Supabase pallet_records to same shape as sheet records
    const dbRecords: PalletRecord[] = dbData.map((r: any) => {
      return {
        id: r.id,
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
    const allRecords = [
      ...resolvedSheet.map((r) => ({ ...r, _source: 'sheet' as const })),
      ...dbRecords,
    ]

    // Upgrade the displayed IF# → current Sales Order number for any record that maps
    // to a live ERPNext order (by line number, else by embedded IF token). Records with
    // no live match keep their original historical IF# (old history preserved).
    for (const r of allRecords) {
      const info = resolveDisplayOrder(orderLookup, r.lineNumber, r.ifNumber)
      if (info) {
        r.ifNumber = info.ifNumber || r.ifNumber
        if (!r.customer || !r.customer.trim()) r.customer = info.customer
        if (!r.category || !r.category.trim()) r.category = info.category
      }
    }

    return NextResponse.json(allRecords)
  } catch (error) {
    console.error('Failed to fetch pallet records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pallet records' },
      { status: 500 }
    )
  }
}
