# Molding Dashboard — Codex Read API

> **Drop this file into Codex's memory** (Codex Desktop: paste into the
> project memory / system-instructions panel; Codex CLI: save as
> `AGENTS.md` in the project root). Codex will read it at session
> start and learn how to query the dashboard's data.

## What this is

A read-only SQL API into the Molding Dashboard's Postgres database
(Supabase). Use it to answer questions about orders, inventory, BOMs,
shipping, sales, the income statement, customers, parts, quality, and
scheduling. Everything you can see on the dashboard, you can query
here — except for a few sensitive tables that are walled off.

## Base URL

```
https://entech-dashboard-v2.vercel.app
```

Use this base for both production and any staging URL Simon shares.
Authenticate with the bearer token he provided you.

## Authentication

Every request needs an `Authorization: Bearer <token>` header. The
token is **secret** — don't echo it back into the conversation, don't
write it to any file, don't paste it into a public PR description.

Example header:

```
Authorization: Bearer <THE_TOKEN_SIMON_GAVE_YOU>
```

## Endpoints

### 1. `GET /api/codex-schema` — discover tables

Call this once at the **start of every session** before asking
anything else. It returns the list of tables you can read, their
columns, types, and (where set) human-readable descriptions.

Request:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://entech-dashboard-v2.vercel.app/api/codex-schema
```

Response shape:

```json
{
  "fetched_at": "2026-05-22T17:55:00.000Z",
  "table_count": 52,
  "tables": [
    {
      "name": "customers",
      "description": "Master customer list (name, contact info, status).",
      "columns": [
        { "name": "id", "type": "uuid", "nullable": false, "description": null },
        { "name": "name", "type": "text", "nullable": false, "description": null }
      ]
    }
  ]
}
```

**Usage tip:** keep the schema result in memory for the duration of
the session. You don't need to call this again unless the user says
they added a new table.

### 2. `POST /api/codex-query` — run a SELECT

Send one read-only SQL statement, get rows back.

Request body:

```json
{
  "query": "SELECT customer, SUM(NULLIF(order_qty,'')::numeric) AS qty FROM dashboard_orders WHERE NULLIF(date_of_request,'')::date >= CURRENT_DATE - INTERVAL '90 days' GROUP BY customer ORDER BY qty DESC LIMIT 20",
  "params": [],
  "limit": 200
}
```

- `query` — required. Must be a single `SELECT` or `WITH ... SELECT`
  statement. No semicolons. No statement chaining.
- `params` — optional array of bound parameters (use `$1`, `$2`, …
  placeholders in the query). **Always parameterize user-supplied
  values.** Don't string-concatenate them into the SQL.
- `limit` — optional row cap (default 1000, max 1000).

Response on success:

```json
{
  "ok": true,
  "columns": [
    { "name": "customer", "dataTypeID": 25 },
    { "name": "qty", "dataTypeID": 1700 }
  ],
  "rows": [
    { "customer": "Cascade", "qty": "12450" }
  ],
  "row_count": 20,
  "truncated": false,
  "elapsed_ms": 87
}
```

Response on error (400):

```json
{
  "ok": false,
  "error": "syntax error at or near …"
}
```

## Hard constraints

- **Read-only.** INSERT / UPDATE / DELETE / DROP / TRUNCATE / ALTER /
  CREATE / GRANT / REVOKE / COMMENT / COPY / VACUUM / NOTIFY / LISTEN
  / SET / BEGIN / COMMIT / DO / PREPARE / EXECUTE are all rejected by
  the validator. Even if you bypassed it, the database role has no
  write privileges, so writes would fail at the DB layer too.
- **Single statement per call.** No `;` chaining.
- **10-second statement timeout.** Long queries get killed. Add
  appropriate `WHERE` filters and `LIMIT`s.
- **Max 1000 rows per response.** Use `LIMIT` + aggregation; don't
  page through huge tables. If you need a sum, use `SUM()`. If you
  need a count, use `COUNT(*)`.
- **No schema other than `public`.** `auth.*`, `pg_*`, etc. are not
  accessible. Schema introspection via `information_schema` is fine.

## Walled-off tables (don't try)

These intentionally return errors:

- `api_audit_log` — your own call log
- `phil_chat_history`, `phil_jobs` — Phil's chat data
- `user_profiles`, `users`, `user_app_roles` — auth/PII
- `push_subscriptions` — device tokens

If the user asks about these, tell them this API doesn't expose them
and suggest they ask Simon directly.

## Data quirks the validator can't catch — read carefully

These are real footguns specific to this database. They've burned
prior callers; learn them once.

1. **Numeric columns stored as text.** `dashboard_orders.order_qty`,
   `revenue`, `cost`, etc. are `text` columns with values like
   `"1,250"` (note the comma). To math on them:

   ```sql
   SUM(REPLACE(NULLIF(order_qty, ''), ',', '')::numeric)
   ```

2. **Date columns stored as text.** `date_of_request`, `shipped_date`,
   etc. are `text`. Cast with `NULLIF(col,'')::date`.

3. **`PO #` is text, not numeric.** Values like
   `"PPO044775-1-LODI"`. Don't `SUM()` or `MAX()` it.

4. **`status` field is free-form.** Filter with `ILIKE 'staged%'` or
   list explicit values; don't assume an enum.

5. **`customer_part_mappings`** has duplicate rows for some
   (customer, part) pairs. The price-lookup API uses MIN
   `lowest_quoted_price`, NULL last; do the same if you need a single
   price.

6. **Multi-tenant data isn't in these tables.** This is the
   Compression Molding line only. Other Entech businesses aren't here.

## Examples

### "What's our lowest-quoted price for Cascade on part ABC123?"

```sql
SELECT m.lowest_quoted_price, m.variable_cost, m.total_cost, m.contribution_level
FROM customer_part_mappings m
JOIN customers c ON c.id = m.customer_id
WHERE c.name ILIKE $1
  AND m.internal_part_number ILIKE $2
ORDER BY m.lowest_quoted_price NULLS LAST
LIMIT 1
```

`params: ["Cascade", "ABC123"]`

### "Check stock on a part"

```sql
SELECT part_number, on_hand, reserved, available
FROM inventory
WHERE part_number ILIKE $1
LIMIT 5
```

### "Last quarter's EBITDA"

```sql
SELECT label, ebitda, ebitda_margin_pct
FROM income_statement_months
ORDER BY month_iso DESC
LIMIT 3
```

### "Open orders for a customer"

```sql
SELECT
  "PO #" AS po,
  part_number,
  REPLACE(NULLIF(order_qty, ''), ',', '')::numeric AS qty,
  status,
  NULLIF(date_of_request, '')::date AS requested
FROM dashboard_orders
WHERE customer ILIKE $1
  AND status NOT ILIKE 'shipped%'
ORDER BY requested NULLS LAST
LIMIT 50
```

### "Top 10 customers by 12-month revenue"

```sql
SELECT
  customer,
  SUM(REPLACE(NULLIF(revenue, ''), ',', '')::numeric) AS revenue_12mo
FROM dashboard_orders
WHERE NULLIF(shipped_date, '')::date >= CURRENT_DATE - INTERVAL '365 days'
GROUP BY customer
ORDER BY revenue_12mo DESC
LIMIT 10
```

### "Income statement line items for April"

```sql
SELECT
  item ->> 'account' AS account,
  (item ->> 'amount')::numeric AS amount
FROM income_statement_months,
     jsonb_array_elements(line_items -> 'expense') AS item
WHERE month_iso = '2026-04'
ORDER BY amount DESC
LIMIT 20
```

## Working pattern

1. **Session start:** GET `/api/codex-schema`. Keep the response.
2. **When asked a question:** match the intent to the right tables,
   write a tight SQL with the right filters, parameterize user input,
   send to `/api/codex-query`.
3. **If you get an error:** read the message. Fix the SQL. Try again.
   Don't loop — three attempts max, then tell the user what's stuck.
4. **If a result has `truncated: true`:** tell the user. Either
   tighten the filter or aggregate.
5. **If a query takes > 5 seconds:** rework it. Add a LIMIT, narrow
   the date range, use an indexed column in the WHERE clause.

## Adding new capabilities later

The API is automatically up-to-date with the database. When Simon
adds a new table to the dashboard, it shows up on the next
`/api/codex-schema` call. No code change needed on your end — just
re-fetch the schema if the user mentions new functionality.

If a table you need is walled off, tell the user — don't try to
work around it.

## Rate / cost notes

Every call is audit-logged with caller IP, user-agent, query prefix,
result, and elapsed time. Burst usage is fine; sustained heavy
querying may be rate-limited later if needed.

## When in doubt

If the user asks for data you genuinely can't get to via this API
(write operations, sending email, modifying records), say so — don't
fabricate a result, don't claim you did something you didn't, don't
work around the read-only constraint.
