-- Per-user printer ACL (default-allow).
-- A user may print to every ENABLED print_stations row UNLESS a row here marks
-- (user_id, station_id) allowed=false. Admins / super-admins bypass entirely.
-- Managed via Admin > Printer Access. Service-role only (RLS on, no policies).
-- NOTE: this table was first created live via the Supabase Management API on
-- 2026-06-26; this migration is the version-controlled record of that schema.
create table if not exists public.user_printer_access (
  user_id uuid not null,
  station_id text not null references public.print_stations(id) on delete cascade,
  allowed boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, station_id)
);

alter table public.user_printer_access enable row level security;
revoke all on public.user_printer_access from anon, authenticated;

comment on table public.user_printer_access is
  'Per-user printer ACL. Default-allow: a station is allowed for a user unless a row here says allowed=false. Admins bypass entirely. Managed via Admin > Printer Access. Service-role only.';
