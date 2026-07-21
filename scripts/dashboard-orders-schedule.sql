-- Shipment scheduling (2026-07-21): planned carrier + scheduled ship date per
-- sales order, dashboard-managed (the ERPNext sync's targeted UPDATE never
-- touches these). Applied to the shared Supabase project on 2026-07-21 via the
-- management API BEFORE the app deploy — the shipping-overview select fails
-- into its degraded fallback if the columns are missing.
alter table public.dashboard_orders
  add column if not exists scheduled_carrier text,
  add column if not exists scheduled_ship_date date,
  add column if not exists schedule_set_by text,
  add column if not exists schedule_set_at timestamptz;
