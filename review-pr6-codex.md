# PR6 Review: Google Sheets gviz -> Sheets API v4

## Findings

1. **Critical - Header row is now treated as data in most fetchers** (`lib/google-sheets.ts`, `toGvizShape`, `fetchSheetDataFromApi`, and all `for (const row of rows)` consumers)
- `fetchSheetDataFromApi()` now returns `rows` that include the header row because `toGvizShape(values)` converts all `values` rows directly.
- Legacy gviz JSON `table.rows` did **not** include headers, so many downstream parsers assume every `row` is data.
- Only `fetchOrders()` and `fetchInventoryHistory()` explicitly skip header rows in this diff; most others do not.
- Likely impacted functions: `fetchInventory`, `fetchProductionMake`, `fetchPalletRecords`, `fetchShippingRecords`, `fetchStagedRecords`, `fetchDrawings`, `fetchBOM`, `fetchBOMSub` (and any additional row-iterating parsers below).
- User-visible effects: bogus records like `"Part Number"`/`"Timestamp"` entries, inflated counts, corrupted sort order, and malformed derived metrics.
- Suggested fix: restore old contract by stripping header row inside `fetchSheetDataFromApi` (or in `toGvizShape`) so `rows` contains data only; or update every consumer to skip row 0 consistently.

2. **High - Breaking runtime requirement with hard failure when env var is absent** (`lib/google-auth.ts`)
- New code throws immediately if `GOOGLE_SERVICE_ACCOUNT_BASE64` is missing.
- This is a deliberate security hardening move, but it is a deployment-breaking change versus public gviz.
- Any environment missing that secret (local dev, preview envs, CI) will fail all Sheets-backed endpoints.
- Suggested fix: document as explicit breaking change and add startup validation with a clear actionable message (and optionally a feature flag/fallback for non-prod).

3. **Medium - `FORMATTED_VALUE` can cause locale/format parsing drift** (`lib/google-sheets.ts`, `fetchSheetDataFromApi`, `cellNumber`)
- Data is fetched with `valueRenderOption: 'FORMATTED_VALUE'`, then parsed from display strings.
- This can misparse locale-specific number formats (e.g., commas/dots conventions), percentages, and currency edge cases.
- Prior behavior from gviz often exposed typed values (`Date(...)`, numeric `v`) for many sheets.
- Suggested fix: prefer `UNFORMATTED_VALUE` where numeric correctness matters, or add locale-aware parsing with tests for representative sheet formats.

4. **Low - Error handling around secret decode is brittle** (`lib/google-auth.ts`)
- Base64 decode / JSON parse failures throw raw errors with little context.
- Suggested fix: wrap decode/parse in a guarded error with a clear message (invalid base64, invalid JSON, missing fields).

## Security notes
- Scope is appropriately read-only (`spreadsheets.readonly`) which is good.
- No obvious direct secret leakage in the diff.
- Ensure this module is only imported server-side (current type extraction to `google-sheets-shared.ts` helps), and avoid any `NEXT_PUBLIC_*` exposure of service account data.

## Breaking changes summary
- Requires `GOOGLE_SERVICE_ACCOUNT_BASE64` in all runtime environments.
- Requires spreadsheet access granted to the service account identity.
- Data-shape contract of `fetchSheetData()` effectively changed (header row included), which breaks multiple existing parsers.

## Test gaps / edge cases to add
- Verify each fetcher against a fixture including header row + at least 2 data rows (assert no header record leaks).
- Validate numeric parsing for `$1,234.56`, `(123.45)`, `12%`, and locale variant strings.
- Validate behavior when sheet title changes (gid->title cache refresh behavior).
- Validate startup behavior when `GOOGLE_SERVICE_ACCOUNT_BASE64` is missing/malformed.
