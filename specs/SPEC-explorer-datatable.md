# SPEC — Explorer → standard DataTable conversion (executor handoff, round 2)

Simon (2026-07-23, msg 1529906338430193804): the Shipment Explorer must offer the
SAME column experience as every other dashboard section — sort, per-column filter,
hide/show columns, drag-reorder, the standard toolbar. Convert
`app/(dashboard)/shipments/explorer/page.tsx` from the custom server-paged table to
`useDataTable` + `DataTable` (`lib/use-data-table.ts`, `components/data-table`).
Reference implementation: `app/(dashboard)/shipped/page.tsx`.

RULES: same as specs/SPEC-shipments-build.md (worktree-only, no git commands,
STOP-on-discrepancy → DONE-C.md, every string via t() with keys in BOTH locales —
note locales were just edited by the director; read them fresh before adding keys).

**Files you own (touch nothing else):** `app/(dashboard)/shipments/explorer/page.tsx`,
`app/api/shipments/explorer/route.ts` (only the addition in item 1), `locales/en.json`,
`locales/es.json`, `DONE-C.md`.

## Design (binding)

1. **Data loading — hybrid.** Server keeps scoping by DATE RANGE + free-text `q`
   (address search hits ilike across 5 columns — too heavy client-side); everything
   else becomes client-side DataTable behavior. Add an `all=1` mode to
   `app/api/shipments/explorer/route.ts`: when present (with the existing filter
   params), return up to 10_000 rows (internal `.range()` loop, pages of 1000, stable
   `.order('sent_at', desc).order('id', desc)` — copy the loop from
   `app/api/shipments/export/route.ts` fetchRows) as `{ rows, count, truncated }`.
   `count` stays the exact total; `truncated: count > 10_000`. `facets` is NOT needed
   in `all=1` responses (facet selects are replaced by column filters). Keep the
   existing paged mode untouched for API compatibility.
2. **Page state:** keep the debounced free-text search input (`q`, 300ms) and the
   from/to date inputs (max = todayET) + the LTL-only chip (it maps to a column value
   filter — keep it as a server param, it is cheap either way: keep server `ltl=1`).
   DROP the source/service/residential facet <select>s — those columns become
   `filterable: true` DataTable columns. On any server-param change, refetch `all=1`
   and hand the rows to `useDataTable`.
3. **Columns** (ColumnDef, storageKey `'shipments-explorer'`): sent_at (sortable,
   render ET `MM/dd HH:mm` — reuse the page's formatEtTimestamp), po_number
   (sortable, filterable), partner (sortable, filterable), part_number (sortable,
   filterable), qty (sortable, right-aligned), ship_to_name (sortable), destination
   (render city/state/zip; sortable by a precomputed `destination` string field —
   add it to each row object when loading), service (sortable, filterable, LTL rows
   render the amber LTL badge exactly as today), residential (filterable via
   'Residential'/'Commercial' string field `destinationType` precomputed on load;
   render the Home/Building2 icon as today), source_system (sortable, filterable),
   tracking (render the FedEx link exactly as today — LTL/no-tracking → dash).
   Sorting on sent_at must sort by the RAW timestamp (precompute `sentAtMs` number
   field and make the column key that field if needed for correct ordering — check
   how use-data-table sorts and pick the approach that orders correctly).
4. **DataTable props:** `noun` shipments (t key), `exportFilename="shipments"`,
   `page="shipments-explorer"`, `pageSize={50}` (DataTable's opt-in pagination),
   phone cards via `renderCard` — port today's card JSX unchanged. Keep
   `useViewFromUrl`/`useAutoExport` wiring like shipped/page.tsx if trivially
   applicable; skip if it fights the server params (note the decision in DONE-C.md).
5. **Exports:** the DataTable toolbar's built-in CSV/Excel export now exports the
   loaded (client-filtered) view — that satisfies "export what I see". KEEP the two
   existing server export buttons (Excel/PDF) next to the search input, labelled via
   the existing keys, exporting the SERVER filter scope (q + dates + ltl) — they are
   the big-range escape hatch. Add a muted caption (bilingual, new key) under them:
   EN "Full-range export — column filters don't apply" / ES equivalent.
6. **Truncation banner:** when `truncated`, show the existing amber warning pattern
   (bilingual, new key): "Showing the newest 10,000 rows — narrow the date range for
   full coverage."
7. **SPS portal link:** add the same header link the Overview page now has (import
   `SPS_PORTAL_URL` from `@/lib/shipments/product-colors`, `ExternalLink` icon,
   `t('shipments.spsPortal')` — key already exists in both locales).
8. **Empty/loading/error states:** keep today's patterns.

## Acceptance (run before DONE-C.md)
- `npm run typecheck` — no new errors (same pre-existing list as before).
- `npx eslint` on your files — clean.
- `npm run build` — compiles (env present in worktree).
- Both locales parse; every new key in both.
