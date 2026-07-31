import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import en from '@/locales/en.json'
import { getLiveInventoryReport } from '@/lib/inventory-report-data'
import { buildInventoryWorkbook, type WorkbookLabels } from '@/lib/inventory-workbook'
import { incompletenessReasons } from '@/lib/inventory-completeness'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const labels: WorkbookLabels = {
  tabByBin: en['inventoryOps.repTabByBin'],
  tabByProduct: en['inventoryOps.repTabByProduct'],
  bin: en['inventoryOps.repBin'],
  itemCode: en['inventoryOps.repItemCode'],
  itemName: en['inventoryOps.repItemName'],
  uom: en['inventoryOps.repUom'],
  qty: en['inventoryOps.repQty'],
  totalQty: en['inventoryOps.repTotalQty'],
  pallets: en['inventoryOps.repPallets'],
  legacyWarning: en['inventoryOps.repLegacyWarn'],
}

/** How many parts the most recent snapshot saw WITH STOCK ON HAND.
 *
 *  "Non-empty" is not the same as "complete": an ERPNext warehouse-permission change or a
 *  filter regression returns a plausible SUBSET, and no field in the REST response says so.
 *  The snapshot written nightly by com.entech.inventory-snapshot is an independent record
 *  of the facility, so it can answer what the live API cannot.
 *
 *  Counting only NON-ZERO rows is the whole point, and the reason the first version of this
 *  guard was useless. Total part count is padded back to full by the catalog zero-fill —
 *  under exactly the failure being guarded against (bins partial, Item list intact) the
 *  padded number barely moves, so the guard passed while the workbook quietly reported
 *  hidden stock as zero. Stocked-part count has no such backfill: it falls with the bins.
 *
 *  Returns null when there is nothing to compare against — a missing snapshot must not
 *  block the report, or one broken cron would silently take out another. The caller's own
 *  baseline (see cron/monthly-inventory-report.sh) is the independent second check. */
async function lastSnapshotStockedPartCount(): Promise<number | null> {
  const { data: latest, error: latestError } = await supabaseAdmin
    .from('inventory_history')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
  if (latestError || !latest?.length) return null
  const { count, error } = await supabaseAdmin
    .from('inventory_history')
    .select('part_number', { count: 'exact', head: true })
    .eq('date', latest[0].date)
    .neq('quantity', 0)
  if (error || !count) return null
  return count
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const actual = Buffer.from(req.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await getLiveInventoryReport()
    // Incomplete beats wrong, and here it also has to beat "send anyway". The dashboard can
    // show a warning banner because a human is looking at the screen; this file is emailed to
    // accounting unattended, so a short workbook would be read as a real inventory count.
    // Refuse, and let the caller retry.
    //
    // stockedCount comes from bin rows alone. `binlessItems` is the zero-fill, and folding
    // it in is what made the first version of this check blind to the failure it exists for.
    const conditions = incompletenessReasons({
      stockedCount: new Set(report.rows.map((row) => row.itemCode)).size,
      rowCount: report.rows.length,
      binlessItemsUnavailable: report.binlessItemsUnavailable,
      snapshotStocked: await lastSnapshotStockedPartCount(),
    })

    if (conditions.length > 0) {
      return NextResponse.json(
        { error: 'Inventory report is incomplete', conditions },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const bytes = await buildInventoryWorkbook(report, labels)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="inventory.xlsx"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    // Match the sibling report route: log the detail, return a generic status. An unhandled
    // throw here would surface as a bare 500 and lose the reason from the server log.
    console.error('monthly inventory report failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
