// Purchasing types — mirrors the "Purchasing Sheet" (all data Combined tab).
// Raw fields are stored in Supabase; computed fields are derived in compute.ts.

/** Raw row as stored in the purchasing_orders table.
 *  Extends Record<string, unknown> so it satisfies the DataTable generic. */
export interface PurchasingOrder extends Record<string, unknown> {
  id: string
  legacy_row: number | null
  item_description: string | null
  external_number: string | null
  quantity: number | null
  total_cost: number | null
  delivery_cost: number | null
  canceled: boolean
  refunded: boolean
  urgent: boolean
  partial_delivery: boolean
  requestor: string | null
  deliver_to: string | null
  sub_department: string | null
  department: string | null
  store: string | null
  supplier_link: string | null
  date_requested: string | null // YYYY-MM-DD
  date_ordered: string | null
  promised_date: string | null
  received_date: string | null
  received_by: string | null
  /** Manual status set from the dropdown; overrides the date-derived status. Null = Auto. */
  status_override: string | null
  poe_cc: string | null
  notes: string | null
  packing_slip_pic: string | null
  item_pic: string | null
  deleted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type OrderStatus =
  | 'Requested'
  | 'Ordered'
  | 'Received'
  | 'Partial'
  | 'Canceled'
  | 'Refunded'
  | ''

/** Display row = raw fields + the 4 sheet-formula columns computed live. */
export interface PurchasingRow extends PurchasingOrder {
  order_status: OrderStatus
  cost_per_unit: number | null
  /** Days until promised delivery when status is Ordered; null otherwise. */
  days_until_delivery: number | null
}

/** Fields a user may set when creating/editing an order (raw inputs only). */
export interface PurchasingInput {
  item_description?: string | null
  external_number?: string | null
  quantity?: number | null
  total_cost?: number | null
  delivery_cost?: number | null
  canceled?: boolean
  refunded?: boolean
  urgent?: boolean
  partial_delivery?: boolean
  requestor?: string | null
  deliver_to?: string | null
  sub_department?: string | null
  department?: string | null
  store?: string | null
  supplier_link?: string | null
  date_requested?: string | null
  date_ordered?: string | null
  promised_date?: string | null
  received_date?: string | null
  received_by?: string | null
  status_override?: string | null
  poe_cc?: string | null
  notes?: string | null
  packing_slip_pic?: string | null
  item_pic?: string | null
}

/** Editable field keys, used for diffing in the audit trail. */
export const EDITABLE_FIELDS: (keyof PurchasingInput)[] = [
  'item_description', 'external_number', 'quantity', 'total_cost', 'delivery_cost',
  'canceled', 'refunded', 'urgent', 'partial_delivery', 'requestor', 'deliver_to',
  'sub_department', 'department', 'store', 'supplier_link', 'date_requested',
  'date_ordered', 'promised_date', 'received_date', 'received_by', 'status_override', 'poe_cc',
  'notes', 'packing_slip_pic', 'item_pic',
]

export interface PurchasingAudit {
  id: string
  order_id: string
  item_description: string | null
  action: 'created' | 'updated' | 'deleted' | 'restored'
  field_name: string | null
  old_value: string | null
  new_value: string | null
  performed_by_name: string | null
  performed_by_email: string | null
  created_at: string
}
