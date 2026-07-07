import { supabaseAdmin } from '@/lib/supabase-admin'
import { erpnextGetDoc } from '@/lib/erpnext/client'

/**
 * Resolve the customer's own part number for an internal item, from the
 * dashboard's customer_part_mappings (the same authoritative source po-bot and
 * the packing slip use). Returns null when the customer has no mapping for the
 * item (e.g. spacers, or an unmapped SKU) — the label just omits the row.
 *
 * `customer` may be omitted when only the Sales Order is known; in that case the
 * SO's customer is looked up from ERPNext first.
 */
export async function resolveCustomerPartNo(
  itemCode: string,
  opts: { customer?: string; salesOrder?: string }
): Promise<string | null> {
  let customerName = opts.customer?.trim() || ''
  if (!customerName && opts.salesOrder) {
    customerName = await erpnextGetDoc<{ customer?: string }>('Sales Order', opts.salesOrder)
      .then((so) => so.customer ?? '')
      .catch(() => '')
  }
  if (!customerName || !itemCode) return null

  const { data: cust } = await supabaseAdmin
    .from('customers')
    .select('id')
    .ilike('name', customerName)
    .maybeSingle()
  if (!cust?.id) return null

  const { data: mapping } = await supabaseAdmin
    .from('customer_part_mappings')
    .select('customer_part_number')
    .eq('customer_id', cust.id)
    .eq('internal_part_number', itemCode)
    .maybeSingle()
  return mapping?.customer_part_number?.trim() || null
}
