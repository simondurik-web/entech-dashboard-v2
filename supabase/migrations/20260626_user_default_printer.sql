-- Per-user default print station — pre-selected in the add-inventory printer
-- dropdown for that user (they can still pick another allowed station). Managed
-- via Admin > Printer Access. Service-role only (RLS on, no policies).
-- Created live via the Supabase Management API on 2026-06-26; this is the record.
create table if not exists public.user_default_printer (
  user_id uuid primary key,
  station_id text references public.print_stations(id) on delete set null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.user_default_printer enable row level security;
revoke all on public.user_default_printer from anon, authenticated;

comment on table public.user_default_printer is
  'Per-user default print station — pre-selected in the add-inventory printer dropdown. Managed via Admin > Printer Access. Service-role only.';
