# Price Lookup API

Read-only HTTP endpoint that returns the authorized customer price for an internal part number. Built for the external Codex agent that verifies POs entered into FileMaker Fusion.

## Endpoint

```
GET https://entech-dashboard-v2.vercel.app/api/price-lookup
```

## Auth

```
Authorization: Bearer <PRICE_LOOKUP_API_KEY>
```

The key is compared using a timing-safe constant-time check. If the env var `PRICE_LOOKUP_API_KEY` is unset on the server, every request fails closed with HTTP 500 — there is no "no auth required" fallback.

## Request

| Param | Required | Example |
|---|---|---|
| `customer` | yes | `Origen RV Accessories` |
| `internal_pn` | yes | `SPG1-6PK` |

Both matches are case-insensitive (`ilike` exact). If multiple mappings exist for the same `(customer, internal_pn)` pair (the `customer-reference` page already warns about these duplicates), the row with the lowest `lowest_quoted_price` wins; rows with `null` price sort last.

## Responses

### 200 OK — match found

```json
{
  "found": true,
  "customer": "Origen RV Accessories",
  "internal_pn": "SPG1-6PK",
  "cust_pn": null,
  "category": "Snap Pad",
  "lowest_price": 38.34,
  "variable_cost": 25.00,
  "total_cost": 28.50,
  "sales_target": 40.00,
  "contribution_status": "Net Profitable",
  "queried_at": "2026-04-29T17:30:00Z"
}
```

### 200 OK — no match

```json
{
  "found": false,
  "customer": "Origen RV Accessories",
  "internal_pn": "SPG1-6PK",
  "message": "No matching record in customer reference table",
  "queried_at": "2026-04-29T17:30:00Z"
}
```

### 400 Bad Request

```json
{ "error": "Missing required query params: customer, internal_pn" }
```

### 401 Unauthorized

```json
{ "error": "Unauthorized" }
```

### 405 Method Not Allowed

```json
{ "error": "Method not allowed. Use GET." }
```

### 500 Internal Server Error

```json
{ "error": "Internal server error", "request_id": "<uuid>" }
```

The `request_id` is also written to the server console log to allow correlation. Returned (not the underlying message) so secrets cannot leak via response bodies.

## Example curl

```bash
curl -H "Authorization: Bearer $PRICE_LOOKUP_API_KEY" \
  "https://entech-dashboard-v2.vercel.app/api/price-lookup?customer=Origen%20RV%20Accessories&internal_pn=SPG1-6PK"
```

## Audit log

Every request is logged into `public.api_audit_log`:

| column | notes |
|---|---|
| `endpoint` | always `/api/price-lookup` |
| `caller_ip` | from `x-forwarded-for` then `x-real-ip` |
| `caller_user_agent` | UA header |
| `query_params` | `{ customer, internal_pn }` jsonb |
| `result` | `found` / `not_found` / `unauthorized` / `bad_request` / `method_not_allowed` / `server_error` |
| `response_time_ms` | end-to-end server time |
| `error_message` | only for `server_error` |

The API key is **never** logged. Phil can review activity via Supabase Studio:

```sql
SELECT created_at, result, query_params, response_time_ms
FROM public.api_audit_log
WHERE endpoint = '/api/price-lookup'
ORDER BY created_at DESC
LIMIT 50;
```

## Hard constraints

- READ-ONLY against pricing tables. The endpoint only `SELECT`s from `customers` and `customer_part_mappings`. The only `INSERT` is into `api_audit_log`.
- `GET` only.
- The endpoint uses the **anon** Supabase key (RLS `public_read_*` policies cover the SELECTs). The service-role key is never read here.
- Timing-safe key comparison.

## Rotating the API key

```bash
# 1. generate a new key
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 2. update Vercel
vercel env rm PRICE_LOOKUP_API_KEY production
vercel env add PRICE_LOOKUP_API_KEY production
vercel --prod   # redeploy so new env binds

# 3. distribute the new key to the Codex agent and update local .env.local
```
