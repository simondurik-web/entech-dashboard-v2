import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import en from '@/locales/en.json'
import { getLiveInventoryReport } from '@/lib/inventory-report-data'
import { buildInventoryWorkbook, type WorkbookLabels } from '@/lib/inventory-workbook'

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
