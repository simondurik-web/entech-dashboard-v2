import type { ColumnDef } from './use-data-table'

/**
 * All possible extra columns for Order-based tables.
 * Each page picks which ones to include as defaultHidden based on
 * what's already shown as a default column.
 */
export function getExtraOrderColumns<T extends Record<string, unknown>>(
  existingKeys: Set<string>
): ColumnDef<T>[] {
  const all: ColumnDef<T>[] = [
    { key: 'line' as keyof T & string, label: 'Line', sortable: true },
    { key: 'ifNumber' as keyof T & string, label: 'IF #', sortable: true },
    { key: 'poNumber' as keyof T & string, label: 'PO #', sortable: true },
    { key: 'customer' as keyof T & string, label: 'Customer', sortable: true, filterable: true },
    { key: 'partNumber' as keyof T & string, label: 'Part #', sortable: true, filterable: true },
    { key: 'orderQty' as keyof T & string, label: 'Qty', sortable: true, render: (v) => v ? (v as number).toLocaleString() : '-' },
    { key: 'category' as keyof T & string, label: 'Category', sortable: true, filterable: true },
    { key: 'dateOfRequest' as keyof T & string, label: 'Requested', sortable: true, render: (v) => { const d = v as string; return d || '-' } },
    { key: 'requestedDate' as keyof T & string, label: 'Due Date', sortable: true, render: (v) => { const d = v as string; return d || '-' } },
    { key: 'daysUntilDue' as keyof T & string, label: 'Days Until', sortable: true, render: (v) => { const d = v as number | null; if (d === null) return '-'; return String(d) } },
    { key: 'packaging' as keyof T & string, label: 'Packaging', sortable: true, filterable: true },
    { key: 'partsPerPackage' as keyof T & string, label: 'Parts/Package', sortable: true, render: (v) => v ? (v as number).toLocaleString() : '-' },
    { key: 'numPackages' as keyof T & string, label: '# Packages', sortable: true, render: (v) => v ? (v as number).toLocaleString() : '-' },
    { key: 'fusionInventory' as keyof T & string, label: 'Fusion Inventory', sortable: true, render: (v) => (v as number).toLocaleString() },
    { key: 'hubMold' as keyof T & string, label: 'Hub Mold', sortable: true, filterable: true },
    { key: 'tire' as keyof T & string, label: 'Tire', sortable: true, filterable: true },
    { key: 'hub' as keyof T & string, label: 'Hub', sortable: true, filterable: true },
    { key: 'bearings' as keyof T & string, label: 'Bearings', sortable: true, filterable: true },
    { key: 'ifStatus' as keyof T & string, label: 'IF Status', sortable: true, filterable: true },
    { key: 'internalStatus' as keyof T & string, label: 'Internal Status', sortable: true, filterable: true },
    { key: 'assignedTo' as keyof T & string, label: 'Assigned To', sortable: true, filterable: true },
    { key: 'dailyCapacity' as keyof T & string, label: 'Daily Capacity', sortable: true, render: (v) => v ? (v as number).toLocaleString() : '-' },
    { key: 'shippedDate' as keyof T & string, label: 'Shipped Date', sortable: true, render: (v) => { const d = v as string; return d || '-' } },
  ]

  // Return only columns not already defined, marked as defaultHidden
  return all
    .filter((col) => !existingKeys.has(col.key))
    .map((col) => ({ ...col, defaultHidden: true }))
}
