-- Toter (Wastequip ShipperTMS) portal-entry request queue.
--
-- Flow: a "Ready to Ship" card on the Shipping Overview shows an "Enter order
-- in Toter portal" button for Toter/Wastequip orders. Clicking it POSTs to
-- /api/po-automation/toter-portal, which inserts a 'queued' row here. A Mac-mini
-- watchdog polls this table and posts a message into #po-automation so claude-5
-- runs the Toter skill (prepare -> enter -> save -> release -> BOL upload). As
-- its final step claude-5 marks the row 'entered'; the card reads status to flip
-- the button to "Order entered".
--
-- Lives in the po_automation schema alongside processed_pos / order_documents.
-- Accessed only via supabaseAdmin (service role, bypasses RLS) so no RLS
-- policies are required (same posture as order_documents).

create schema if not exists po_automation;

create table if not exists po_automation.toter_portal_entries (
  id                uuid primary key default gen_random_uuid(),
  -- Order keys. `line` is the primary per-order handle on the shipping overview
  -- (multiple order lines can share one IF#); if_number/po_number/customer are
  -- carried for claude-5's lookup + display.
  line              text,
  if_number         text,
  po_number         text,
  customer          text,
  status            text not null default 'queued'
                      check (status in ('queued','notified','running','entered','failed','canceled')),
  shipment_number   text,        -- portal-generated shipment # (set on entry)
  bol_uploaded      boolean not null default false,
  error             text,
  requested_by      text,        -- dashboard user id that clicked the button
  requested_by_name text,
  claimed_by        text,        -- worker/instance that picked up the request
  claimed_at        timestamptz,
  entered_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists toter_portal_entries_line_idx
  on po_automation.toter_portal_entries (line);
create index if not exists toter_portal_entries_status_idx
  on po_automation.toter_portal_entries (status, created_at);
create index if not exists toter_portal_entries_if_idx
  on po_automation.toter_portal_entries (if_number);
