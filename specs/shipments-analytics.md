# Shipments section — plan for claude-3 (director) + gpt-5.6-sol (executor)

**Author:** claude-4, 2026-07-23 (Simon's directive: Discord msgs 1529843039302848543,
1529843451540017402, 1529843777424855174). **Builder:** claude-3 directs; codex
`gpt-5.6-sol` (reasoning high or xhigh — global default is already xhigh) implements in an
isolated worktree per the fleet Director/executor split (`~/clawd/ROUTING.md`).
**Why:** the SPS/marketplace fulfillment robots (Home Depot live, Amazon starting
2026-07-24, Shopify later) ship boxes daily. This data does NOT go into ERPNext — the
dashboard gets a dedicated section so Entech can see what ships every day, search it, and
(as history accumulates) forecast from it.

## Data sources (the funnel — already flowing, nothing new to build upstream)

1. **`public.shipment_history`** (Supabase project `mqfjmzqeccufqhisqpij`) — one row per
   PO line item, written automatically by every run (H.37 of the SPS skills; fail-open).
   Columns in use: `run_id, po_number, partner, ship_to_name, ship_to_address, city,
   state, zip, residential (bool), service, source_system, tracking, part_number, qty,
   email, phone` + insert timestamp. Unique key `(run_id, po_number, part_number)`.
   `source_system` distinguishes channels: `SPS EDI (Home Depot)` today,
   `SPS-Amazon` from tomorrow, Shopify later. **This column is the contract** — any new
   robot writes the same table with its own source_system; nothing else needs to change
   for its data to appear here. 247 rows as of 2026-07-23 (runs R2–R7).
   LTL freight set-asides are rows with `service = 'LTL (set-aside)'` (they have no
   tracking — that is correct, not missing data).
2. **Storage bucket `shipment-deliverables`** (private; created 2026-07-23) — each run
   uploads its four print PDFs to `<YYYY-MM-DD>/<name>-<YYYYMMDD>.pdf`
   (packing-slips-fedex, packing-slips-LTL, labels-print, run-summary). This feeds the
   print page — the floor prints from the dashboard (the email leg was dropped as noise;
   Discord + dashboard are the delivery channels).

## Feature scope (v1)

**S1 — Shipments home (dedicated nav section "Shipments").**
Daily headline: boxes/orders shipped today + this week, split by source_system, LTL
count, and a "today's print files" shortcut to S4.

**S2 — Ship-volume chart.** Bar/area chart of units shipped per day, **stacked/colored by
product** (part_number family). Filters: by month, by custom date range; roll-ups by
**quarter and by year** (same chart, coarser buckets, plus a totals table). This is the
forecasting view — it must stay usable as rows grow 100×.

**S3 — Shipment explorer.** Table of all rows, newest first, with a **search bar**
filtering by **address** (ship_to_name/address/city/state/zip), **product**
(part_number), and **time** (date range picker). Facet filters: source_system, service,
residential/commercial, LTL-only. Tracking numbers link out to carrier tracking.
**Export the current filtered view to Excel (.xlsx) and to PDF** — exports respect
active filters and are generated server-side (the table will exceed browser-side limits
as data grows).

**S4 — Print/deliverables page.** By date (default today): list each day's four PDFs from
the `shipment-deliverables` bucket with view/print buttons. Files are served via
**short-lived signed URLs generated on request** — NEVER baked into static/ISR HTML
(fleet hard rule). Date picker for past days. (Note: the run's email delivery was
DROPPED by Simon 2026-07-23 msg 1529858065728540713 — Discord + this page are the only
delivery channels; this page is how the floor prints.)

**S5 — Direct print dispatch (Simon msg 1529858065728540713).** Each file on S4 gets a
**"Send to printer"** action targeting a named physical printer, not just the browser
print dialog:
- Printer registry (admin-editable): at least **"Shipping — Zebra"** (4×6 thermal) and
  **"SnapPad printer"**, plus the **regular letter printer**.
- **Routing defaults by file type:** `labels-print-*.pdf` (4×6) → **Shipping Zebra by
  DEFAULT** (user may switch to the SnapPad printer); `packing-slips-*.pdf` and
  `run-summary-*.pdf` (letter) → the **regular printer**. Never send a letter PDF to a
  Zebra or vice versa — block mismatched combinations in the UI.
- **Implementation note (claude-3 decides the mechanics):** browsers cannot silently
  target a specific printer, so this needs a dispatch path — recommended: a
  `print_jobs` table (file path, printer, status, requested_by, timestamps) the
  dashboard inserts into, plus a small local print agent on the machine that can reach
  the printers (CUPS `lpr -P <queue>` / Zebra raw 203dpi; the fleet LaunchAgent pattern
  applies), polling and updating job status shown in the UI. **OPEN QUESTION for Simon
  during build:** exact printer names/queues + which machine is physically connected to
  each (the SnapPad printer likely already has a working queue from SnapPad
  fulfillment — reuse it).

## Access control (Simon's D1 answer, msg 1529843451540017402)

Gate the whole section with the dashboard's EXISTING admin-panel role-permissions
feature (a new permission key, e.g. `shipments.view`), so Simon can adjust who sees it
per role — do NOT hardcode an admin-only check. Follow the existing permission-key
pattern in the admin panel.

## Hard constraints (fleet rules — violations get bounced at review)

- **Bilingual EN/ES in the same commit** for every user-facing string.
- **Mobile-friendly** — Simon reviews from his phone; the floor may use tablets.
- supabase-js returns Postgres **numeric columns as strings** — parse before math.
- supabase-js **silently caps un-ranged selects at 1000 rows** — all reads must
  `.range()`-paginate or aggregate server-side (prefer a Postgres view/RPC for S2's
  daily aggregates; do not ship a client-side reduce over the whole table).
- Signed/expiring URLs never in static/ISR HTML (S4 rule above).
- Branch off latest **main**; deploy to **staging** (canonical URL
  dashboard-staging.4molding.com); staging Coolify does NOT auto-deploy — trigger via
  the Coolify API (see `reference_dashboard_staging_no_autodeploy` memory / project
  CLAUDE.md). 4-model review panel before staging push; Simon approves before main.
- Codex executor works in an isolated worktree, **reads files from the worktree not the
  shared checkout**, and does NOT commit (worktree index gotcha) — claude-3 reviews
  line-by-line and commits.

## Out of scope (v1)

Forecasting models (the views just make the history usable), ERPNext integration,
editing/correcting rows from the UI (read-only v1), email/phone display (PII — omit from
the UI in v1; revisit with Simon).

## Definition of done

S1–S5 on staging (S5 print agent may land as a fast-follow if printer details block —
everything else does not wait on it), permission-gated, EN/ES, mobile-checked, chart buckets verified
against SQL by hand for at least 3 days of data, Excel/PDF exports open correctly,
4-model panel passed, CONTEXT.md updated.
