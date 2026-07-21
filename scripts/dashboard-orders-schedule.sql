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

-- Atomic compare-and-set for schedule writes (round-5 review: check-then-write
-- allowed two same-token saves to both pass). Locks the token rows, re-reads,
-- refuses on mismatch, updates with a shipped-row guard — one transaction.
-- Applied 2026-07-21 alongside the columns; service_role execute only.
create or replace function public.set_order_schedule(
  p_check_ids bigint[],
  p_all_ids bigint[],
  p_carrier text,
  p_date date,
  p_set_by text,
  p_expected timestamptz,
  p_enforce boolean
) returns table(updated integer, conflict boolean, new_set_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur timestamptz;
  n integer;
  stamp timestamptz := now();
begin
  -- Lock EVERY row this call may touch, in deterministic id order — two
  -- concurrent saves from different member SOs of one truckload lock the
  -- same rows in the same order instead of deadlocking (round-6 review).
  perform 1 from (
    select id from public.dashboard_orders where id = any(p_all_ids) order by id for update
  ) locked;
  select max(schedule_set_at) into cur from public.dashboard_orders where id = any(p_check_ids);
  if p_enforce and cur is distinct from p_expected then
    return query select 0, true, cur;
    return;
  end if;
  update public.dashboard_orders
     set scheduled_carrier = p_carrier,
         scheduled_ship_date = p_date,
         schedule_set_by = p_set_by,
         schedule_set_at = stamp
   where id = any(p_all_ids)
     and (work_order_status is null or work_order_status <> 'shipped')
     and (shipped_date is null or shipped_date = '');
  get diagnostics n = row_count;
  return query select n, false, stamp;
end
$$;
revoke all on function public.set_order_schedule(bigint[], bigint[], text, date, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.set_order_schedule(bigint[], bigint[], text, date, text, timestamptz, boolean) to service_role;
