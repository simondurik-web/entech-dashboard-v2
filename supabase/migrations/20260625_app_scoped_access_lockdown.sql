-- App-scoped access lockdown (SECURITY, 2026-06-25).
--
-- Problem: the molding dashboard and the SnapPad portal share this Supabase
-- project (same auth.users). The dashboard's role resolvers fell back to
-- user_profiles.role when a user had no user_app_roles(app_id='dashboard') row,
-- and user_profiles.role defaulted to 'regular_user'. So anyone who signed in via
-- Google on EITHER app auto-got molding floor access (e.g. abdo@rvsnappad.com).
--
-- Fix (code, shipped alongside this migration): overlayAppRole + every server
-- guard (erpnext/auth, quality/purchasing/po-automation/pallets guards, phil chat)
-- now resolve `dashboardRole ?? 'visitor'` — molding access REQUIRES an explicit
-- dashboard enrollment. The live `role_permissions` visitor row has empty
-- menu_access, so non-enrolled = no access. The user_profiles.role column default
-- was also flipped to 'visitor' (separate change, already applied).
--
-- Also adds a 'blocked' dashboard role (hard-deny; enforced in canAccess +
-- AccessGuard + deny-by-default in every guard). No schema change: user_app_roles.role
-- is free text (no CHECK), so 'blocked' stores fine.
--
-- Backfill (below): BEFORE the strict resolvers take effect, give every user who
-- currently has access via user_profiles.role (non-visitor profile, no dashboard
-- app-role) an explicit dashboard app-role = their current profile.role, so
-- existing floor workers keep working. Idempotent.

INSERT INTO public.user_app_roles (user_id, app_id, role)
SELECT up.id, 'dashboard', up.role
FROM public.user_profiles up
WHERE up.role NOT IN ('visitor', 'blocked')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_app_roles uar
    WHERE uar.user_id = up.id AND uar.app_id = 'dashboard'
  )
ON CONFLICT (user_id, app_id) DO NOTHING;
