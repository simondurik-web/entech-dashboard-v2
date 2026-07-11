/**
 * Read-only MCP tool registry. Every tool funnels through the same data
 * functions the dashboard pages use (lib/supabase-data), so an AI answer and
 * the on-screen dashboard can never disagree. There is deliberately NO write
 * path anywhere in this module.
 *
 * Access levels (mcp_access.scope): v1 grants everyone full_read; each tool
 * declares which levels may call it so production_only / financial tiers can
 * ship later as data-only changes.
 */
import {
  fetchOrdersFromDB,
  fetchInventoryFromDB,
  fetchProductionMakeFromDB,
  normalizeStatus,
  type Order,
} from "@/lib/supabase-data"
import { supabaseAdmin } from "@/lib/supabase-admin"

type JsonSchema = Record<string, unknown>

export interface McpToolDef {
  name: string
  description: string
  inputSchema: JsonSchema
  accessLevels: string[] // mcp_access.scope values allowed to call this tool
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function clampLimit(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10)
  if (isNaN(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

function strArg(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** Compact order shape for AI consumption (subset of the dashboard Order). */
function orderView(o: Order) {
  return {
    line: o.line,
    customer: o.customer,
    partNumber: o.partNumber,
    poNumber: o.poNumber, // text — values like 'PPO044775-1-LODI'
    ifNumber: o.ifNumber,
    qty: o.orderQty,
    status: normalizeStatus(o.internalStatus, o.ifStatus),
    rawStatus: o.internalStatus || o.ifStatus,
    category: o.category,
    priority: o.computedPriority ?? (o.priorityLevel ? `P${o.priorityLevel}` : null),
    requestedDate: o.requestedDate,
    daysUntilDue: o.daysUntilDue,
    shippedDate: o.shippedDate || null,
    assignedTo: o.assignedTo || null,
    packaging: o.packaging || null,
    numPackages: o.numPackages || null,
  }
}

const OPEN_STATUSES = new Set(["pending", "wip", "staged"])

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "dashboard_summary",
    description:
      "High-level snapshot of the Entech molding dashboard: open order counts by status, " +
      "customers with open orders, and how many inventory items are at or below minimum. " +
      "Good first call to orient yourself.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async () => {
      const [orders, inventory] = await Promise.all([
        fetchOrdersFromDB(),
        fetchInventoryFromDB(),
      ])
      const open = orders.filter(
        (o) => !o.shippedDate && OPEN_STATUSES.has(normalizeStatus(o.internalStatus, o.ifStatus))
      )
      const byStatus: Record<string, number> = {}
      const byCustomer: Record<string, number> = {}
      for (const o of open) {
        const s = normalizeStatus(o.internalStatus, o.ifStatus)
        byStatus[s] = (byStatus[s] ?? 0) + 1
        byCustomer[o.customer] = (byCustomer[o.customer] ?? 0) + 1
      }
      const lowStock = inventory.filter((i) => i.minimum > 0 && i.inStock <= i.minimum)
      return {
        openOrderLines: open.length,
        openByStatus: byStatus,
        openByCustomer: byCustomer,
        inventoryItemsTracked: inventory.length,
        itemsAtOrBelowMinimum: lowStock.length,
        note: "Quantities are raw unit counts as tracked in ERPNext (packs are counted as packs, not pieces).",
      }
    },
  },
  {
    name: "list_open_orders",
    description:
      "List open (unshipped) order lines: pending, WIP (in production), and staged (ready to ship). " +
      "Optionally filter by customer name (contains), status (pending|wip|staged), or part number (contains).",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Filter: customer name contains (case-insensitive)" },
        status: { type: "string", enum: ["pending", "wip", "staged"], description: "Filter: normalized status" },
        part_number: { type: "string", description: "Filter: part number contains (case-insensitive)" },
        limit: { type: "number", description: `Max rows (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const customer = strArg(args.customer).toLowerCase()
      const status = strArg(args.status).toLowerCase()
      const part = strArg(args.part_number).toLowerCase()
      const limit = clampLimit(args.limit)

      const orders = await fetchOrdersFromDB()
      let open = orders.filter(
        (o) => !o.shippedDate && OPEN_STATUSES.has(normalizeStatus(o.internalStatus, o.ifStatus))
      )
      if (customer) open = open.filter((o) => o.customer.toLowerCase().includes(customer))
      if (status) open = open.filter((o) => normalizeStatus(o.internalStatus, o.ifStatus) === status)
      if (part) open = open.filter((o) => o.partNumber.toLowerCase().includes(part))

      const total = open.length
      return {
        totalMatching: total,
        truncated: total > limit,
        orders: open.slice(0, limit).map(orderView),
      }
    },
  },
  {
    name: "lookup_order",
    description:
      "Find specific order lines by PO number, IF number, or part number (contains match, case-insensitive). " +
      "PO numbers are TEXT like 'PPO044775-1-LODI'. Searches all live orders including shipped ones.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "PO #, IF #, or part number fragment" },
        limit: { type: "number", description: `Max rows (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      required: ["query"],
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const q = strArg(args.query).toLowerCase()
      if (!q) return { error: "query is required" }
      const limit = clampLimit(args.limit)
      const orders = await fetchOrdersFromDB()
      const matches = orders.filter(
        (o) =>
          o.poNumber.toLowerCase().includes(q) ||
          o.ifNumber.toLowerCase().includes(q) ||
          o.partNumber.toLowerCase().includes(q)
      )
      return {
        totalMatching: matches.length,
        truncated: matches.length > limit,
        orders: matches.slice(0, limit).map(orderView),
      }
    },
  },
  {
    name: "search_inventory",
    description:
      "Search inventory by part number or product name (contains, case-insensitive). Returns available " +
      "stock (on-hand minus committed), physical on-hand, committed-to-orders, and minimum target. " +
      "Quantities are raw ERPNext unit counts — a '48-pack' item counts packs, never multiply by pieces.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part number or product name fragment" },
        limit: { type: "number", description: `Max rows (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      required: ["query"],
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const q = strArg(args.query).toLowerCase()
      if (!q) return { error: "query is required" }
      const limit = clampLimit(args.limit)
      const items = await fetchInventoryFromDB()
      const matches = items.filter(
        (i) => i.partNumber.toLowerCase().includes(q) || i.product.toLowerCase().includes(q)
      )
      return {
        totalMatching: matches.length,
        truncated: matches.length > limit,
        items: matches.slice(0, limit).map((i) => ({
          partNumber: i.partNumber,
          product: i.product || null,
          available: i.inStock,
          onHand: i.onHand,
          committed: i.committed,
          minimum: i.minimum,
          itemType: i.itemType || null,
          department: i.department || null,
          daysToMin: i.daysToMin,
          daysToZero: i.daysToZero,
        })),
      }
    },
  },
  {
    name: "low_stock_report",
    description:
      "Inventory items at or below their minimum target, sorted by biggest shortfall first. " +
      "These are the items production should replenish soonest.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: `Max rows (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const limit = clampLimit(args.limit)
      const items = await fetchInventoryFromDB()
      const low = items
        .filter((i) => i.minimum > 0 && i.inStock <= i.minimum)
        .sort((a, b) => (b.minimum - b.inStock) - (a.minimum - a.inStock))
      return {
        totalMatching: low.length,
        truncated: low.length > limit,
        items: low.slice(0, limit).map((i) => ({
          partNumber: i.partNumber,
          product: i.product || null,
          available: i.inStock,
          minimum: i.minimum,
          shortfall: i.minimum - i.inStock,
          itemType: i.itemType || null,
        })),
      }
    },
  },
  {
    name: "production_needs",
    description:
      "What production should make: parts whose available stock is below the minimum buffer or below " +
      "open-order demand. partsToBeMade = the quantity that covers open orders and restores the minimum.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: `Max rows (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const limit = clampLimit(args.limit)
      const items = await fetchProductionMakeFromDB()
      const toMake = items.filter((i) => i.partsToBeMade > 0)
      return {
        totalMatching: toMake.length,
        truncated: toMake.length > limit,
        items: toMake.slice(0, limit).map((i) => ({
          partNumber: i.partNumber,
          product: i.product || null,
          moldType: i.moldType || null,
          available: i.fusionInventory,
          committed: i.committed,
          minimum: i.minimums,
          neededForOpenOrders: i.neededOpenOrders,
          partsToBeMade: i.partsToBeMade,
        })),
      }
    },
  },
  {
    name: "shipping_staged_overview",
    description:
      "Orders staged and ready to ship (including loaded), grouped by customer, with real pallet-record " +
      "counts where pallets have been recorded.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: `Max order lines (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const limit = clampLimit(args.limit)
      const orders = await fetchOrdersFromDB()
      const allStaged = orders.filter(
        (o) => !o.shippedDate && normalizeStatus(o.internalStatus, o.ifStatus) === "staged"
      )
      const staged = allStaged.slice(0, limit)

      // Real pallet counts per dashboard line (preferred over the
      // number_of_packages estimate when records exist).
      const lines = staged.map((o) => o.line).filter(Boolean)
      const palletCounts = new Map<string, number>()
      if (lines.length > 0) {
        const { data } = await supabaseAdmin
          .from("pallet_records")
          .select("line_number")
          .in("line_number", lines.slice(0, 500))
        for (const row of data ?? []) {
          const key = String(row.line_number)
          palletCounts.set(key, (palletCounts.get(key) ?? 0) + 1)
        }
      }

      const byCustomer: Record<string, unknown[]> = {}
      for (const o of staged) {
        const entry = {
          ...orderView(o),
          palletsRecorded: palletCounts.get(o.line) ?? null,
          estimatedPackages: o.numPackages || null,
        }
        ;(byCustomer[o.customer] = byCustomer[o.customer] ?? []).push(entry)
      }
      return { stagedLines: allStaged.length, truncated: allStaged.length > limit, byCustomer }
    },
  },
  {
    name: "recent_fulfillments",
    description:
      "Recent shipping/fulfillment activity from the ERP system (ERPNext): orders staged, shipped, " +
      "and BOLs signed, with sales-order number, customer, and pallet counts. Newest first. " +
      "Optionally filter by customer name or SO number (contains, case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Filter: customer name contains" },
        so_number: { type: "string", description: "Filter: ERP sales-order number contains (e.g. SO-00021)" },
        limit: { type: "number", description: `Max rows (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT})` },
      },
      additionalProperties: false,
    },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async (args) => {
      const limit = clampLimit(args.limit)
      const customer = strArg(args.customer)
      const soNumber = strArg(args.so_number)
      let query = supabaseAdmin
        .from("fulfillment_log")
        .select("created_at, action, so_number, dn_number, customer, pallets, user_name, detail")
        .order("created_at", { ascending: false })
        .limit(limit)
      if (customer) query = query.ilike("customer", `%${customer.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      if (soNumber) query = query.ilike("so_number", `%${soNumber.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      const { data, error } = await query
      if (error) return { error: `fulfillment query failed: ${error.message}` }
      return {
        rows: (data ?? []).map((r) => ({
          at: r.created_at,
          action: r.action,
          soNumber: r.so_number,
          deliveryNote: r.dn_number || null,
          customer: r.customer,
          pallets: r.pallets ?? null,
          by: r.user_name || null,
          detail: r.detail || null,
        })),
        note: "Live ERPNext fulfillment events (staged / shipped / BOL signed).",
      }
    },
  },
  {
    name: "bom_lookup",
    description:
      "Bill of materials for a finished part: components, quantities, and cost breakdown " +
      "(material / packaging / labor+energy / total). Matches part number by contains (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        part_number: { type: "string", description: "Finished part number (fragment ok)" },
      },
      required: ["part_number"],
      additionalProperties: false,
    },
    // Cost data — excluded from a future production_only tier by design.
    accessLevels: ["full_read", "financial"],
    handler: async (args) => {
      const q = strArg(args.part_number).toLowerCase()
      if (!q) return { error: "part_number is required" }
      // Escape ILIKE metacharacters so the query is a literal "contains",
      // matching the JS .includes() semantics of every other tool.
      const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`)
      const { data, error } = await supabaseAdmin
        .from("bom_final_assemblies")
        .select("id, part_number, product_category, description, parts_per_package, total_cost, variable_cost, labor_cost_per_part")
        .ilike("part_number", `%${escaped}%`)
        .order("part_number")
        .limit(25)
      if (error) return { error: `BOM query failed: ${error.message}` }
      const parts = data ?? []

      const withComponents = await Promise.all(
        parts.slice(0, 5).map(async (p) => {
          const { data: comps } = await supabaseAdmin
            .from("bom_final_assembly_components")
            .select("component_part_number, component_source, quantity, cost, sort_order")
            .eq("final_assembly_id", p.id)
            .order("sort_order")
            .limit(100)
          return {
            partNumber: p.part_number,
            description: p.description || null,
            category: p.product_category || null,
            partsPerPackage: p.parts_per_package || null,
            totalCost: p.total_cost ?? null,
            variableCost: p.variable_cost ?? null,
            laborCostPerPart: p.labor_cost_per_part ?? null,
            components: (comps ?? []).map((c) => ({
              partNumber: c.component_part_number,
              source: c.component_source,
              quantity: c.quantity,
              cost: c.cost,
            })),
          }
        })
      )
      return {
        totalMatching: parts.length,
        truncated: parts.length > 5,
        assemblies: withComponents,
      }
    },
  },
]

export function toolsForAccessLevel(level: string): McpToolDef[] {
  return MCP_TOOLS.filter((t) => t.accessLevels.includes(level))
}
