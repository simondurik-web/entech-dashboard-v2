import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireReadAccess } from '@/lib/require-user'

// Slim lookup feed for the Orders Data "Customer Part #" column: every
// (customer, internal part) → customer part number pair from
// customer_part_mappings — the same authoritative source the packing slip and
// po-bot resolve from (lib/erpnext/customer-part.ts). Deliberately excludes
// pricing tiers/costs so the orders page never ships quote data to the client.
// Same auth gate as /api/orders-archive.
export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    type MappingRow = {
      internal_part_number: string | null
      customer_part_number: string | null
      customers: { name: string | null } | { name: string | null }[] | null
    }
    // PostgREST caps each response at max_rows (1000 on this project) no matter
    // the requested range — paginate in stable, ordered pages until a short
    // page, same pattern as fetchAllRows in lib/supabase-data.ts.
    const rows: MappingRow[] = []
    const pageSize = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('customer_part_mappings')
        .select('internal_part_number, customer_part_number, customers(name)')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      rows.push(...(data as MappingRow[]))
      if (data.length < pageSize) break
      offset += pageSize
    }

    const out = rows
      .map((m: MappingRow) => {
        const cust = Array.isArray(m.customers) ? m.customers[0] : m.customers
        return {
          customer: cust?.name?.trim() || '',
          internalPart: m.internal_part_number?.trim() || '',
          customerPart: m.customer_part_number?.trim() || '',
        }
      })
      .filter((m) => m.customer && m.internalPart && m.customerPart)

    return NextResponse.json(out)
  } catch (error) {
    console.error('Failed to fetch customer part numbers:', error)
    return NextResponse.json({ error: 'Failed to fetch customer part numbers' }, { status: 500 })
  }
}
