-- Add the "Advanced User" role (skilled production-line workers who need more
-- access than a regular line worker but less than a group leader).
--
-- Access model: role_permissions is the source of truth — a role with no row
-- gets ZERO access. We seed advanced_user as an exact copy of regular_user's
-- current menu_access (safe baseline); admins then grant the extra sections in
-- Admin -> Permissions. Slotted at sort_order 2 (right after regular_user), so
-- existing roles at >= 2 shift up by one to keep the matrix ordering.
--
-- Idempotent: guarded on the row not already existing, so re-applying is a
-- no-op. This mirrors what was applied to the live entech Supabase on
-- 2026-06-25 (the production DB is shared by the staging + prod deploys; this
-- file exists so fresh/local environments get the same role).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role = 'advanced_user') THEN
    UPDATE public.role_permissions SET sort_order = sort_order + 1 WHERE sort_order >= 2;

    INSERT INTO public.role_permissions (role, label, description, menu_access, sort_order)
    SELECT
      'advanced_user',
      'Advanced User',
      'Skilled production-line workers — more access than a regular user, granted per section',
      menu_access,
      2
    FROM public.role_permissions
    WHERE role = 'regular_user';
  END IF;
END $$;
