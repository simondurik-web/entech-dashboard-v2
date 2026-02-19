#!/usr/bin/env node
// Bulk i18n patching script
import { readFileSync, writeFileSync } from 'fs'

function patch(file, replacements) {
  let content = readFileSync(file, 'utf8')
  
  // Add useI18n import if missing
  if (!content.includes('useI18n')) {
    // Find the last import line
    const lines = content.split('\n')
    let lastImportIdx = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) lastImportIdx = i
    }
    lines.splice(lastImportIdx + 1, 0, "import { useI18n } from '@/lib/i18n'")
    content = lines.join('\n')
  }
  
  // Add const { t } = useI18n() if missing
  if (!content.includes('const { t } = useI18n()')) {
    // Find the component function and add after first line of state/hooks
    // Look for first useState or useEffect or useCallback
    const hookPattern = /^(\s+)(const \[|const \{[^}]*\} = use(?!I18n))/m
    const match = content.match(hookPattern)
    if (match) {
      const idx = content.indexOf(match[0])
      content = content.slice(0, idx) + match[1] + 'const { t } = useI18n()\n' + content.slice(idx)
    }
  }
  
  for (const [old, newStr] of replacements) {
    if (content.includes(old)) {
      content = content.replace(old, newStr)
    } else {
      // Try as regex
      if (old instanceof RegExp) {
        content = content.replace(old, newStr)
      }
    }
  }
  
  writeFileSync(file, content)
  console.log(`✅ Patched ${file}`)
}

const base = 'app/(dashboard)'

// inventory/page.tsx
patch(`${base}/inventory/page.tsx`, [
  ['>📦 Inventory</h1>', '>📦 {t(\'page.inventory\')}</h1>'],
  ['>Inventory levels, usage forecasting & trend analysis</p>', '>{t(\'page.inventorySubtitle\')}</p>'],
  ['>Total Items</p>', '>{t(\'inventory.totalItems\')}</p>'],
  ['>Low Stock</p>', '>{t(\'stats.lowStock\')}</p>'],
  ['>Needs Production</p>', '>{t(\'stats.needsProduction\')}</p>'],
  ['>Adequate Stock</p>', '>{t(\'inventory.adequateStock\')}</p>'],
  ['>📈 Inventory History — {partNumber}</h2>', '>📈 {t(\'inventory.historyTitle\')} — {partNumber}</h2>'],
])

// drawings/page.tsx  
patch(`${base}/drawings/page.tsx`, [
  ['>📐 Drawings Library</h1>', '>📐 {t(\'page.drawings\')}</h1>'],
  ['>No drawing</div>', '>{t(\'drawings.noDrawing\')}</div>'],
])

// pallet-records/page.tsx - already has useI18n, just fix remaining strings
patch(`${base}/pallet-records/page.tsx`, [
  ['>Order: {record.orderNumber}</span>', '>{t(\'table.orders\')}: {record.orderNumber}</span>'],
])

// staged-records/page.tsx
patch(`${base}/staged-records/page.tsx`, [
  ['>Date</span>', '>{t(\'table.date\')}</span>'],
  ['>Qty</span>', '>{t(\'table.qty\')}</span>'],
  ['>Location</span>', '>{t(\'stagedRecords.location\')}</span>'],
])

// sales-overview/page.tsx
patch(`${base}/sales-overview/page.tsx`, [
  ['>Total Costs</p>', '>{t(\'salesOverview.totalCosts\')}</p>'],
  ['>Total P/L</p>', '>{t(\'salesOverview.totalPL\')}</p>'],
  ['>Avg Margin</p>', '>{t(\'salesOverview.avgMargin\')}</p>'],
  ['>Revenue by Category</h3>', '>{t(\'salesOverview.revenueByCategory\')}</h3>'],
  ['>Top 10 Customers by Revenue</h3>', '>{t(\'salesOverview.topCustomers\')}</h3>'],
  ['>Monthly P/L Trend (Last 12 Months)</h3>', '>{t(\'salesOverview.monthlyPLTrend\')}</h3>'],
])

// sales-parts/page.tsx
patch(`${base}/sales-parts/page.tsx`, [
  ['>Part # <ArrowUpDown', '>{t(\'table.partNumber\')} <ArrowUpDown'],
  ['<th className="px-3 py-3 text-left font-medium">Category</th>', '<th className="px-3 py-3 text-left font-medium">{t(\'table.category\')}</th>'],
  ['>Orders <ArrowUpDown', '>{t(\'table.orders\')} <ArrowUpDown'],
  ['>Total Qty <ArrowUpDown', '>{t(\'table.qty\')} <ArrowUpDown'],
  ['>Revenue <ArrowUpDown', '>{t(\'table.revenue\')} <ArrowUpDown'],
  ['>Costs <ArrowUpDown', '>{t(\'salesOverview.totalCosts\')} <ArrowUpDown'],
  ['>Margin <ArrowUpDown', '>{t(\'salesOverview.avgMargin\')} <ArrowUpDown'],
  ['>Individual Orders:</p>', '>{t(\'salesParts.individualOrders\')}:</p>'],
  ['<th className="text-left px-2 py-1">Line</th>', '<th className="text-left px-2 py-1">{t(\'table.line\')}</th>'],
  ['<th className="text-left px-2 py-1">Customer</th>', '<th className="text-left px-2 py-1">{t(\'table.customer\')}</th>'],
  ['<th className="text-right px-2 py-1">Qty</th>', '<th className="text-right px-2 py-1">{t(\'table.qty\')}</th>'],
  ['<th className="text-right px-2 py-1">Revenue</th>', '<th className="text-right px-2 py-1">{t(\'table.revenue\')}</th>'],
  ['<th className="text-left px-2 py-1">Shipped</th>', '<th className="text-left px-2 py-1">{t(\'status.shipped\')}</th>'],
])

// sales-customers/page.tsx
patch(`${base}/sales-customers/page.tsx`, [
  ['>Customer <ArrowUpDown', '>{t(\'table.customer\')} <ArrowUpDown'],
  ['>Orders <ArrowUpDown', '>{t(\'table.orders\')} <ArrowUpDown'],
  ['>Total Qty <ArrowUpDown', '>{t(\'table.qty\')} <ArrowUpDown'],
  ['>Revenue <ArrowUpDown', '>{t(\'table.revenue\')} <ArrowUpDown'],
  ['>Costs <ArrowUpDown', '>{t(\'salesOverview.totalCosts\')} <ArrowUpDown'],
  ['>Margin <ArrowUpDown', '>{t(\'salesOverview.avgMargin\')} <ArrowUpDown'],
  ['>Orders by Part Number:</p>', '>{t(\'salesCustomers.ordersByPart\')}:</p>'],
  ['<th className="text-left px-2 py-1">Line</th>', '<th className="text-left px-2 py-1">{t(\'table.line\')}</th>'],
  ['<th className="text-left px-2 py-1">Part #</th>', '<th className="text-left px-2 py-1">{t(\'table.partNumber\')}</th>'],
  ['<th className="text-left px-2 py-1">Category</th>', '<th className="text-left px-2 py-1">{t(\'table.category\')}</th>'],
  ['<th className="text-right px-2 py-1">Qty</th>', '<th className="text-right px-2 py-1">{t(\'table.qty\')}</th>'],
  ['<th className="text-right px-2 py-1">Revenue</th>', '<th className="text-right px-2 py-1">{t(\'table.revenue\')}</th>'],
  ['<th className="text-left px-2 py-1">Shipped</th>', '<th className="text-left px-2 py-1">{t(\'status.shipped\')}</th>'],
])

// sales-dates/page.tsx
patch(`${base}/sales-dates/page.tsx`, [
  ['>Monthly Revenue & P/L (Last 12 Months)</h3>', '>{t(\'salesDates.monthlyRevenuePL\')}</h3>'],
  ['>Month <ArrowUpDown', '>{t(\'salesDates.month\')} <ArrowUpDown'],
  ['>Orders <ArrowUpDown', '>{t(\'table.orders\')} <ArrowUpDown'],
  ['>Total Qty <ArrowUpDown', '>{t(\'table.qty\')} <ArrowUpDown'],
  ['>Revenue <ArrowUpDown', '>{t(\'table.revenue\')} <ArrowUpDown'],
  ['>Costs <ArrowUpDown', '>{t(\'salesOverview.totalCosts\')} <ArrowUpDown'],
  ['>Margin <ArrowUpDown', '>{t(\'salesOverview.avgMargin\')} <ArrowUpDown'],
  ['name="Revenue"', 'name={t(\'table.revenue\')}'],
])

// all-data/page.tsx
patch(`${base}/all-data/page.tsx`, [
  ['>Showing</p>', '>{t(\'allData.showing\')}</p>'],
  ['>Toggle Columns</span>', '>{t(\'ui.columns\')}</span>'],
])

// bom/page.tsx
patch(`${base}/bom/page.tsx`, [
  ['>Individual Items ({individualItems.length})</TabsTrigger>', '>{t(\'bom.individualItems\')} ({individualItems.length})</TabsTrigger>'],
  ['>Sub Assemblies ({subAssemblies.length})</TabsTrigger>', '>{t(\'bom.subAssemblies\')} ({subAssemblies.length})</TabsTrigger>'],
  ['>Final Assemblies ({finalAssemblies.length})</TabsTrigger>', '>{t(\'bom.finalAssemblies\')} ({finalAssemblies.length})</TabsTrigger>'],
  ['>Raw Materials & Purchased Parts</CardTitle>', '>{t(\'bom.rawMaterials\')}</CardTitle>'],
  ['>Changing a cost here cascades to all sub-assemblies and final assemblies using this material.</p>', '>{t(\'bom.costCascadeNote\')}</p>'],
  ['>Add Individual Item</DialogTitle>', '>{t(\'bom.addItem\')}</DialogTitle>'],
  ['placeholder="Description"', 'placeholder={t(\'table.description\')}'],
  ['placeholder="Supplier"', 'placeholder={t(\'bom.supplier\')}'],
  ['>Cancel</Button></DialogClose>', '>{t(\'ui.cancel\')}</Button></DialogClose>'],
  ['>Save</Button>', '>{t(\'ui.save\')}</Button>'],
  ['>Part Number</TableHead>', '>{t(\'table.partNumber\')}</TableHead>'],
  ['>Description</TableHead>', '>{t(\'table.description\')}</TableHead>'],
  ['>Cost/Unit</TableHead>', '>{t(\'bom.costPerUnit\')}</TableHead>'],
  ['>Unit</TableHead>', '>{t(\'bom.unit\')}</TableHead>'],
])

// material-requirements/page.tsx - already has t() for most things, check for remaining
// customer-reference/page.tsx
patch(`${base}/customer-reference/page.tsx`, [
  ['placeholder="All Customers"', 'placeholder={t(\'salesCustomers.allCustomers\')}'],
  ['placeholder="All Levels"', 'placeholder={t(\'customerRef.allLevels\')}'],
  ['>Critical Loss</SelectItem>', '>{t(\'customerRef.criticalLoss\')}</SelectItem>'],
  ['>Marginal Coverage</SelectItem>', '>{t(\'customerRef.marginalCoverage\')}</SelectItem>'],
  ['>Net Profitable</SelectItem>', '>{t(\'customerRef.netProfitable\')}</SelectItem>'],
  ['>Target Achieved</SelectItem>', '>{t(\'customerRef.targetAchieved\')}</SelectItem>'],
  ["{saving ? 'Saving...' : 'Save'}", "{saving ? t('ui.saving') : t('ui.save')}"],
  ["{editingMapping ? 'Edit' : 'Add'} Part Mapping", "{editingMapping ? t('ui.edit') : t('ui.add')} {t('customerRef.partMapping')}"],
  ['placeholder="Select customer"', 'placeholder={t(\'customerRef.selectCustomer\')}'],
  ['placeholder="Range"', 'placeholder={t(\'customerRef.range\')}'],
  ['placeholder="Price"', 'placeholder={t(\'table.price\')}'],
  ["{saving ? 'Saving...' : editingMapping ? 'Update' : 'Create'}", "{saving ? t('ui.saving') : editingMapping ? t('customerRef.update') : t('customerRef.create')}"],
  ["{saving ? 'Deleting...' : 'Delete'}", "{saving ? t('customerRef.deleting') : t('ui.delete')}"],
])

// admin/users/page.tsx
patch(`${base}/admin/users/page.tsx`, [
  ["{enrolling ? 'Adding...' : 'Add'}", "{enrolling ? t('admin.adding') : t('ui.add')}"],
  ["{u.full_name || 'No name'}", "{u.full_name || t('admin.noName')}"],
  [": 'Never'}", ": t('admin.never')}"],
])

// admin/permissions/page.tsx - the PAGE_LABELS map
patch(`${base}/admin/permissions/page.tsx`, [
  ["'/orders': 'Orders',", "'/orders': t('nav.ordersData'),"],
  ["'/need-to-make': 'Need to Make',", "'/need-to-make': t('nav.productionMake'),"],
  ["'/need-to-package': 'Need to Package',", "'/need-to-package': t('nav.ordersQueue'),"],
  ["'/staged': 'Staged',", "'/staged': t('nav.ordersStaged'),"],
  ["'/shipped': 'Shipped',", "'/shipped': t('nav.ordersShipped'),"],
  ["'/inventory': 'Inventory',", "'/inventory': t('nav.inventory'),"],
  ["'/drawings': 'Drawings',", "'/drawings': t('nav.drawingsLibrary'),"],
  ["'/pallet-records': 'Pallet Records',", "'/pallet-records': t('nav.palletRecords'),"],
  ["'/shipping-records': 'Shipping Records',", "'/shipping-records': t('nav.shippingRecords'),"],
  ["'/fp-reference': 'FP Reference',", "'/fp-reference': t('nav.fpReference'),"],
  ["'/staged-records': 'Staged Records',", "'/staged-records': t('nav.stagedRecords'),"],
  ["'/sales-overview': 'Sales Overview',", "'/sales-overview': t('nav.salesOverview'),"],
  ["'/sales-parts': 'Sales by Part',", "'/sales-parts': t('nav.salesByPart'),"],
  ["'/sales-customers': 'Sales by Customer',", "'/sales-customers': t('nav.salesByCustomer'),"],
  ["'/sales-dates': 'Sales by Date',", "'/sales-dates': t('nav.salesByDate'),"],
  ["'/customer-reference': 'Customer Ref',", "'/customer-reference': t('nav.customerRef'),"],
  ["'/quotes': 'Quotes',", "'/quotes': t('nav.quotes'),"],
  ["'/bom': 'BOM',", "'/bom': t('nav.bom'),"],
  ["'/material-requirements': 'Material Reqs',", "'/material-requirements': t('nav.materialReqs'),"],
  ["'/all-data': 'All Data',", "'/all-data': t('nav.allData'),"],
])

// OrderDetail.tsx
patch('components/OrderDetail.tsx', [
  [">Show less", ">{t('orderDetail.showLess')}"],
])

console.log('\n✅ All files patched!')
