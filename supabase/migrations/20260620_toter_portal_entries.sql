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
                      check (status in ('queued','notified','running','awaiting_approval','entered','failed','canceled')),
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

-- One in-flight (or completed) portal entry per IF#. The downstream Toter skill
-- is keyed entirely by IF number (one IF# = one portal shipment) even though a
-- dashboard order can have multiple lines sharing that IF#. This partial unique
-- index is the DB backstop against double freight bookings from concurrent
-- clicks across an IF#'s line cards. 'failed'/'canceled' rows are excluded so a
-- failed attempt can be retried with a fresh request.
create unique index if not exists toter_portal_entries_active_if_uniq
  on po_automation.toter_portal_entries (if_number)
  where status in ('queued','notified','running','awaiting_approval','entered');

-- Keep updated_at fresh on every status transition (the watchdog / claude-5
-- write status back as the entry progresses).
create or replace function po_automation.toter_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists toter_portal_entries_set_updated_at on po_automation.toter_portal_entries;
create trigger toter_portal_entries_set_updated_at
  before update on po_automation.toter_portal_entries
  for each row execute function po_automation.toter_set_updated_at();

-- ── Write-back contract (Mac-mini watchdog + claude-5) ──────────────────────
-- The dashboard only ENQUEUES (status='queued') and READS. The consumer side
-- updates rows via the Supabase Management API SQL path already used by
-- release_toter.py (token at ~/clawd/secrets/supabase-access-token.json),
-- keyed by if_number (NOT line — the skill has no line concept):
--   notified:           SET status='notified', claimed_by=<worker>, claimed_at=now() WHERE if_number=$1 AND status='queued'
--   running / awaiting_approval: SET status=<...> WHERE if_number=$1
--   entered:            SET status='entered', shipment_number=$2, bol_uploaded=true, entered_at=now() WHERE if_number=$1
--   failed:             SET status='failed', error=$2 WHERE if_number=$1
-- A stale-claim reaper should flip rows stuck in notified/running past a TTL
-- (claimed_at) back to 'failed' so the card stops showing "Entry requested…".
