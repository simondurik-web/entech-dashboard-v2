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
import { KNOWLEDGE_FULL } from "@/lib/mcp/knowledge"
import { runReadOnlyQuery } from "@/lib/mcp/query-db"
import { guardQuery, sanitizeQueryError } from "@/lib/mcp/query-guard"

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

/**
 * Every tool description carries this prefix.
 *
 * Why: remote AI clients (Grok/ChatGPT/Gemini) reason from the description of
 * whichever tool they happened to call FIRST. After a single inventory lookup
 * one of them concluded the connector was "scoped to tire inventory only" and
 * stopped trying the other tools for the rest of the conversation — it never
 * re-read its own tool list. Restating the full scope on EVERY tool makes that
 * failure impossible: any single tool the model reads tells it what else exists.
 */
const SCOPE =
  "[Entech Molding Dashboard — one of 13 read-only tools covering: open orders & backlog, " +
  "order lookup, inventory & stock levels, low stock, what production needs to make, " +
  "staged/shipping status, ERP (ERPNext) fulfillment history, BOM & costs, the customer list, " +
  "business context/terminology, the database schema, and free-form read-only SQL (run_query) " +
  "for anything the curated tools don't cover. If a question touches ANY business data, the " +
  "answer is available here — call the right tool, never assume the data is missing.] "

/**
 * Loose text match for human-typed names. Case-insensitive, and ignores spaces,
 * hyphens, periods and commas — so "home care" finds "Homecare Products, Inc.",
 * "eb thd" finds "EB-THD-48PK", and "SO 21" finds "SO-00021". Real users (and
 * models guessing at spelling) never type the stored form exactly.
 */
function loosely(haystack: string, needle: string): boolean {
  const n = strip(needle)
  // A needle that normalizes to nothing (e.g. "---") would match EVERY row.
  if (!n) return false
  if (strip(haystack).includes(n)) return true
  // Second pass ignores zero-padding, so "SO 21" still finds "SO-00021".
  // Purely additive — it can only add matches, never remove one.
  const c = unpad(needle)
  return c ? unpad(haystack).includes(c) : false
}

function strip(s: string): string {
  return s.toLowerCase().replace(/[\s\-.,_/]/g, "")
}

/** strip() + drop leading zeros inside digit runs ("so00021" → "so21"). */
function unpad(s: string): string {
  return strip(s).replace(/0*(\d+)/g, "$1")
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
      SCOPE +
      "START HERE when you are unsure what exists or what to call. Live snapshot of the whole " +
      "operation: how many orders are open and their status breakdown (pending / WIP / staged), " +
      "EVERY customer with open orders and their order counts, and how many inventory items are " +
      "at or below their minimum. Takes no arguments. Use this to discover exact customer names " +
      "before filtering other tools.",
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
      SCOPE +
      "THE tool for any question about orders, the backlog, or what is due — 'how many open orders', " +
      "'what do we owe customer X', 'what's in production', 'what's ready to ship'. Lists open " +
      "(unshipped) order lines: pending, WIP (in production), staged (ready to ship). Returns customer, " +
      "part number, PO #, IF #, qty, status, priority, due date. Filter by customer, status, or part " +
      "number. Customer matching is forgiving — 'home care' finds 'Homecare Products, Inc.'. " +
      "If a customer filter returns nothing, call with NO filter (or call dashboard_summary) to see " +
      "the real customer names before concluding there are no orders.",
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
      const customer = strArg(args.customer)
      const status = strArg(args.status).toLowerCase()
      const part = strArg(args.part_number)
      const limit = clampLimit(args.limit)

      const orders = await fetchOrdersFromDB()
      const allOpen = orders.filter(
        (o) => !o.shippedDate && OPEN_STATUSES.has(normalizeStatus(o.internalStatus, o.ifStatus))
      )
      let open = allOpen
      if (customer) open = open.filter((o) => loosely(o.customer, customer))
      if (status) open = open.filter((o) => normalizeStatus(o.internalStatus, o.ifStatus) === status)
      if (part) open = open.filter((o) => loosely(o.partNumber, part))

      const total = open.length

      // An empty result is the moment a model wrongly concludes "there is no
      // such data". Only offer the customer list when the CUSTOMER NAME itself
      // is what matched nothing — if the customer exists but the status/part
      // filter excluded everything, saying "wrong customer name" would be a lie.
      const customerMatchedNothing =
        !!customer && !allOpen.some((o) => loosely(o.customer, customer))

      let hint: Record<string, unknown> = {}
      if (total === 0 && customerMatchedNothing) {
        hint = {
          note:
            "That customer name matched nothing. The data IS available — these are the customers " +
            "with open orders right now; retry with one of these exact names.",
          customersWithOpenOrders: [...new Set(allOpen.map((o) => o.customer))].sort(),
          totalOpenOrdersUnfiltered: allOpen.length,
        }
      } else if (total === 0) {
        hint = {
          note:
            "No orders matched THIS combination of filters, but other data exists — " +
            `there are ${allOpen.length} open orders in total. Loosen or drop a filter and retry; ` +
            "do NOT conclude the data is unavailable.",
          totalOpenOrdersUnfiltered: allOpen.length,
        }
      }

      return {
        totalMatching: total,
        truncated: total > limit,
        orders: open.slice(0, limit).map(orderView),
        ...hint,
      }
    },
  },
  {
    name: "lookup_order",
    description:
      SCOPE +
      "Look up a SPECIFIC order when you have an identifier — 'where is PO 44775', 'what happened to " +
      "IF 12345', 'show me orders for part 618.261.1911'. Searches ALL orders including already-shipped " +
      "ones (use list_open_orders for the open backlog instead). PO numbers are TEXT, not numbers " +
      "(e.g. 'PPO044775-1-LODI'). Matching ignores spaces and dashes.",
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
      const q = strArg(args.query)
      if (!q) return { error: "query is required" }
      const limit = clampLimit(args.limit)
      const orders = await fetchOrdersFromDB()
      const matches = orders.filter(
        (o) =>
          loosely(o.poNumber, q) || loosely(o.ifNumber, q) || loosely(o.partNumber, q)
      )
      if (matches.length === 0) {
        return {
          totalMatching: 0,
          orders: [],
          note:
            `No order matches the identifier "${q}" — this does NOT mean the data is unavailable. ` +
            `"${q}" may be a CUSTOMER name (call list_customers / list_open_orders) rather than a ` +
            "PO, IF, or part number. Check before reporting anything as missing.",
        }
      }
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
      SCOPE +
      "Stock levels for a part — 'how many 308 tires do we have', 'what's our stock of EB-THD'. " +
      "Covers ALL inventory (tires, hubs, molded parts, Snap Pad, Roll Tech, packaging), not just one " +
      "product line. Returns available stock (on-hand minus committed), physical on-hand, " +
      "committed-to-orders, and the minimum target. NOTE: this tool answers stock questions ONLY — " +
      "for orders use list_open_orders, for shipping use shipping_staged_overview. " +
      "Quantities are raw ERPNext unit counts — a '48-pack' item counts PACKS; never multiply by pieces.",
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
      const q = strArg(args.query)
      if (!q) return { error: "query is required" }
      const limit = clampLimit(args.limit)
      const items = await fetchInventoryFromDB()
      const matches = items.filter(
        (i) => loosely(i.partNumber, q) || loosely(i.product, q)
      )

      // A miss here is where models stall: Grok searched inventory for
      // "home care" (a CUSTOMER), got nothing, and wandered for 90s before
      // finding the right tool. Point it at the right one immediately.
      if (matches.length === 0) {
        return {
          totalMatching: 0,
          items: [],
          note:
            `No INVENTORY ITEM matches "${q}" — but that does NOT mean the data is unavailable. ` +
            `"${q}" may be a CUSTOMER (call list_customers or list_open_orders), an order/PO number ` +
            "(call lookup_order), or a product family rather than a stocked part number. " +
            "Try one of those before telling the user anything is missing.",
        }
      }
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
      SCOPE +
      "'What are we running low on / what needs reordering / what's below minimum' — every inventory " +
      "item at or below its minimum target, biggest shortfall first, across ALL product lines.",
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
      SCOPE +
      "'What should we make / what does the floor need to run / what are we short for open orders' — " +
      "parts whose available stock is below the minimum buffer or below open-order demand. " +
      "partsToBeMade = the quantity that covers open orders AND restores the minimum.",
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
      SCOPE +
      "'What's staged / ready to ship / on the dock / going out' — orders staged and ready to ship " +
      "(including loaded), grouped by customer, with real pallet counts where pallets were recorded. " +
      "For what ALREADY shipped, use recent_fulfillments instead.",
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
    name: "list_customers",
    description:
      SCOPE +
      "The EXACT customer names as stored, with how many open orders each has. Call this whenever a " +
      "customer filter came back empty or you are unsure how a customer is spelled — e.g. the user says " +
      "'home care products' but the stored name is 'Homecare Products, Inc.'. Never tell the user a " +
      "customer has no data until you have checked this list.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async () => {
      const orders = await fetchOrdersFromDB()
      const counts = new Map<string, { open: number; total: number }>()
      for (const o of orders) {
        if (!o.customer) continue
        const cur = counts.get(o.customer) ?? { open: 0, total: 0 }
        cur.total += 1
        const isOpen =
          !o.shippedDate && OPEN_STATUSES.has(normalizeStatus(o.internalStatus, o.ifStatus))
        if (isOpen) cur.open += 1
        counts.set(o.customer, cur)
      }
      return {
        customers: [...counts.entries()]
          .map(([name, c]) => ({ name, openOrders: c.open, totalOrderLines: c.total }))
          .sort((a, b) => b.openOrders - a.openOrders || a.name.localeCompare(b.name)),
      }
    },
  },
  {
    name: "recent_fulfillments",
    description:
      SCOPE +
      "'What shipped this week / did customer X's order go out / what happened to SO-00021' — recent " +
      "shipping activity straight from the ERP system (ERPNext): orders staged, shipped, and BOLs " +
      "signed, with sales-order number, customer, pallet counts and who did it. Newest first. " +
      "Customer/SO matching ignores spaces and dashes.",
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
      // Filtering happens in JS so matching is as forgiving as the other tools
      // ("home care" → "Homecare Products, Inc.", "SO 21" → SO-00021). That means
      // a filtered call must scan the WHOLE table, not just the newest page —
      // otherwise a real-but-older shipment reads back as "no results".
      // supabase-js silently caps un-ranged selects at 1000 rows, so paginate.
      const COLS = "created_at, action, so_number, dn_number, customer, pallets, user_name, detail"
      const filtering = !!(customer || soNumber)
      type Row = Record<string, unknown>
      let data: Row[] = []
      let scanTruncated = false

      if (!filtering) {
        const { data: rows, error } = await supabaseAdmin
          .from("fulfillment_log")
          .select(COLS)
          .order("created_at", { ascending: false })
          .limit(limit)
        if (error) return { error: `fulfillment query failed: ${error.message}` }
        data = rows ?? []
      } else {
        const PAGE = 1000
        const MAX_SCAN = 20000 // hard backstop; log-style table grows slowly
        for (let offset = 0; offset < MAX_SCAN; offset += PAGE) {
          const { data: rows, error } = await supabaseAdmin
            .from("fulfillment_log")
            .select(COLS)
            .order("created_at", { ascending: false })
            .range(offset, offset + PAGE - 1)
          if (error) return { error: `fulfillment query failed: ${error.message}` }
          const page = rows ?? []
          data.push(...page)
          if (page.length < PAGE) break
          if (offset + PAGE >= MAX_SCAN) scanTruncated = true
        }
        if (customer) data = data.filter((r) => loosely(String(r.customer ?? ""), customer))
        if (soNumber) data = data.filter((r) => loosely(String(r.so_number ?? ""), soNumber))
      }

      const matched = data.length
      data = data.slice(0, limit)
      return {
        rows: data.map((r) => ({
          at: r.created_at,
          action: r.action,
          soNumber: r.so_number,
          deliveryNote: r.dn_number || null,
          customer: r.customer,
          pallets: r.pallets ?? null,
          by: r.user_name || null,
          detail: r.detail || null,
        })),
        totalMatching: matched,
        truncated: matched > limit,
        ...(scanTruncated
          ? { warning: "History scan hit its row cap — very old events may be omitted." }
          : {}),
        note: "Live ERPNext fulfillment events (staged / shipped / BOL signed).",
      }
    },
  },
  {
    name: "business_context",
    description:
      SCOPE +
      "Entech's full business knowledge: what the company does, product lines, how to decode part " +
      "numbers (6XX.YYY.ZZZZ wheels, 3-digit tires, H-prefix hubs), order status flow, priority " +
      "rules, inventory semantics, production rates, and answering rules. Call this ONCE early in a " +
      "conversation — it makes every other answer more accurate. No arguments.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    accessLevels: ["full_read", "production_only", "financial"],
    handler: async () => ({ context: KNOWLEDGE_FULL }),
  },
  {
    name: "describe_tables",
    description:
      SCOPE +
      "Live database schema: every table the read-only query role can see, with columns and types. " +
      "Call this before writing a run_query SQL statement, or when a curated tool doesn't cover " +
      "what the user asked. Optionally filter by table-name fragment.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Optional: only tables whose name contains this" },
      },
      additionalProperties: false,
    },
    accessLevels: ["full_read"],
    handler: async (args) => {
      const filter = strArg(args.table).toLowerCase()
      const tables = await runReadOnlyQuery(async (client) => {
        const { rows } = await client.query(`
          SELECT c.table_name, c.column_name, c.data_type
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND has_table_privilege(current_user, (c.table_schema || '.' || c.table_name)::regclass, 'SELECT')
          ORDER BY c.table_name, c.ordinal_position
        `)
        return rows as Array<{ table_name: string; column_name: string; data_type: string }>
      })
      const byTable = new Map<string, string[]>()
      for (const r of tables) {
        if (filter && !r.table_name.toLowerCase().includes(filter)) continue
        const cols = byTable.get(r.table_name) ?? []
        cols.push(`${r.column_name} (${r.data_type})`)
        byTable.set(r.table_name, cols)
      }
      return {
        tableCount: byTable.size,
        tables: [...byTable.entries()].map(([name, columns]) => ({ name, columns })),
        note:
          "Key tables: dashboard_orders (live orders), dashboard_orders_fusion_archive " +
          "(pre-2026-06-30 history), inventory (item_number, real_number_value = available, " +
          "on_hand_total, reserved_staged, minimum), production_totals (part list + mold types), " +
          "bom_final_assemblies + bom_final_assembly_components (+ bom_sub_assemblies / " +
          "bom_individual_items), pallet_records, fulfillment_log (ERP shipping events), " +
          "customer_part_mappings (customer part numbers + packaging).",
        sqlGotchas: [
          "MANY dashboard_orders columns are TEXT holding numbers/dates, and blanks are EMPTY " +
            "STRINGS, not NULL. Casting fails on ''. Always use NULLIF(col,'')::numeric (or " +
            "::date) — e.g. sum(NULLIF(order_qty,'')::numeric).",
          "Unshipped orders: (shipped_date IS NULL OR shipped_date = '').",
          "po_number is TEXT (e.g. 'PPO044775-1-LODI') — never compare it numerically.",
          "Order status lives in work_order_status / if_status_fusion (raw ERP text); " +
            "'staged' also covers 'loaded', and 'invoiced'/'to bill' mean shipped.",
        ],
      }
    },
  },
  {
    name: "run_query",
    description:
      SCOPE +
      "Escape hatch when NO curated tool answers the question: run a custom read-only SQL SELECT " +
      "against the live dashboard database (Postgres). Call describe_tables first to learn the " +
      "schema. Single SELECT/WITH statement only, max 200 rows returned. The database login is " +
      "read-only — writes are impossible — and auth/token tables are invisible to it. " +
      "Prefer the curated tools when they fit; use this for joins, aggregations, date math, " +
      "or columns the other tools don't return.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "One read-only SELECT (or WITH … SELECT) statement" },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    accessLevels: ["full_read"],
    handler: async (args) => {
      const sql = typeof args.sql === "string" ? args.sql : ""
      const verdict = guardQuery(sql)
      if (!verdict.ok) return { error: `Query rejected: ${verdict.reason}` }

      const MAX_ROWS = 200
      const MAX_ROW_CHARS = 20_000 // bound bytes PER ROW at the database
      try {
        const inner = sql.trim().replace(/;\s*$/, "")
        const rows = await runReadOnlyQuery(async (client) => {
          // Serialize each row to JSON and truncate it AT THE DATABASE with
          // left(), so a pathological SELECT repeat('x',5e8) or a giant
          // json/array/bytea value can't cross the wire and blow up Node.
          // (statement_timeout + work_mem bound the DB side.)
          const res = await client.query({
            text: `SELECT left(row_to_json(mcp_q)::text, ${MAX_ROW_CHARS}) AS mcp_row
                   FROM (${inner}) mcp_q LIMIT ${MAX_ROWS + 1}`,
          })
          return res.rows as Array<{ mcp_row: string }>
        })
        const truncated = rows.length > MAX_ROWS
        const capped = rows.slice(0, MAX_ROWS)
        let anyRowClipped = false
        const parsed = capped.map((r) => {
          const raw = r.mcp_row ?? "null"
          if (raw.length >= MAX_ROW_CHARS) anyRowClipped = true
          try {
            return JSON.parse(raw)
          } catch {
            // Row was clipped mid-JSON by left(); hand back the raw prefix.
            anyRowClipped = true
            return { _clipped: raw }
          }
        })
        return {
          rowCount: parsed.length,
          truncated,
          rows: parsed,
          ...(truncated
            ? { note: `Result capped at ${MAX_ROWS} rows — add aggregation or a WHERE clause.` }
            : {}),
          ...(anyRowClipped
            ? { rowsClipped: `Rows exceeding ${MAX_ROW_CHARS} chars were truncated — select fewer/narrower columns.` }
            : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "query failed"
        return sanitizeQueryError(message)
      }
    },
  },
  {
    name: "bom_lookup",
    description:
      SCOPE +
      "'What goes into part X / what does it cost us to make / what's the BOM' — bill of materials for " +
      "a finished part: components, quantities, and full cost breakdown (material / labor / total). " +
      "These are INTERNAL MANUFACTURING COSTS — they are NOT the customer selling price or quoted " +
      "price; never present them as what a customer pays.",
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
