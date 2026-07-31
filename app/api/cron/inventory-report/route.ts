import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import en from '@/locales/en.json'
import { getLiveInventoryReport } from '@/lib/inventory-report-data'
import { buildProductTotals } from '@/lib/inventory-report'
import { buildInventoryWorkbook, type WorkbookLabels } from '@/lib/inventory-workbook'
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

/** Below this share of the last daily snapshot's part count, treat the live pull as partial.
 *
 *  Deliberately loose. The two numbers are not the same measurement: the snapshot keeps
 *  parts the live catalogue filter drops, so the live count sits legitimately below it —
 *  measured 2026-07-31 at 1,142 live against 1,219 in the snapshot, a 6% gap with nothing
 *  wrong. A 0.9 floor would leave ~3 points of headroom and eventually fire on a healthy
 *  month, and a false alarm here means no report at all. 0.75 still catches losing a
 *  quarter of the catalogue, and the failure this guards against — a warehouse permission
 *  change exposing a subset — takes out far more than that. */
const COMPLETENESS_FLOOR = 0.75

/** How many distinct parts the most recent daily snapshot saw.
 *
 *  "Non-empty" is not the same as "complete": an ERPNext warehouse-permission change or a
 *  filter regression returns a plausible SUBSET, and no field in the REST response says so.
 *  The snapshot written every night by com.entech.inventory-snapshot is an independent
 *  record of how many parts the facility actually has, so it can answer the question the
 *  live API cannot.
 *
 *  Returns null when there is nothing to compare against — a missing snapshot must not
 *  block the report, or one broken cron would silently take out another. */
async function lastSnapshotPartCount(): Promise<number | null> {
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
    const conditions: string[] = []
    if (report.rows.length === 0) conditions.push('ERPNext returned no inventory rows')
    if (report.binlessItemsUnavailable) conditions.push('zero-quantity catalog items are unavailable')
    // A non-empty result is not a complete one. Compare the catalogue we are about to ship
    // against last night's independent snapshot; a big shortfall means ERPNext handed us a
    // subset, which would otherwise produce a perfectly normal-looking, materially wrong
    // spreadsheet in an accountant's inbox.
    const productCount = buildProductTotals(report.rows, report.binlessItems).length
    const snapshotCount = await lastSnapshotPartCount()
    if (snapshotCount !== null && productCount < Math.floor(snapshotCount * COMPLETENESS_FLOOR)) {
      conditions.push(
        `only ${productCount} parts, against ${snapshotCount} in the latest daily snapshot — looks like a partial inventory`
      )
    }

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
