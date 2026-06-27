-- Flip the per-user printer ACL from DEFAULT-ALLOW to DEFAULT-DENY.
--
-- Old model: a (user, station) pair was ALLOWED unless a user_printer_access row
--   said allowed=false. New users and new printers were auto-accessible.
-- New model: a pair is DENIED unless a user_printer_access row says allowed=true.
--   New users and newly-added printers start with ZERO access; an admin must
--   explicitly grant each (user, station) pair from Admin > Printer Access.
--   Admins / super-admins still bypass entirely (always all printers).
--
-- This migration is the version-controlled record of a change first applied live
-- via the Supabase Management API on 2026-06-27. The code (lib/erpnext/printer-access.ts,
-- the admin matrix page + API, the print-stations dropdown route) was switched to
-- the grant-based model in the same change.

-- 1) PRESERVE current effective access at cutover. Under the old default-allow
--    model every active inventory-ops user (and admins) could print to every
--    enabled station unless explicitly denied. Recreate that exact set as
--    explicit allowed=true grants so nobody loses printing mid-shift.
insert into public.user_printer_access (user_id, station_id, allowed, updated_at)
select p.id, s.id, true, now()
from public.user_profiles p
cross join public.print_stations s
where s.enabled = true
  and p.is_active is not false
  and exists (
    select 1 from public.user_app_roles ar
    where ar.user_id = p.id
      and ar.app_id = 'dashboard'
      and (
        ar.role in ('admin', 'super_admin')
        or exists (
          select 1 from public.role_permissions rp
          where rp.role = ar.role
            and (rp.menu_access ->> '/inventory-ops')::boolean = true
        )
      )
  )
  and not exists (
    select 1 from public.user_printer_access d
    where d.user_id = p.id and d.station_id = s.id and d.allowed = false
  )
on conflict (user_id, station_id) do update set allowed = true, updated_at = now();

-- 2) Drop now-redundant deny rows: under default-deny, "no row" already means
--    denied, so allowed=false rows carry no information in the grant-only model.
delete from public.user_printer_access where allowed = false;

-- 3) Update the table comment to reflect the new posture.
comment on table public.user_printer_access is
  'Per-user printer ACL. Default-DENY: a station is denied for a user unless a row here says allowed=true. Admins bypass entirely. New users and new printers start with no access. Managed via Admin > Printer Access. Service-role only.';
