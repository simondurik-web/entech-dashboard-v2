-- Phase 3 — RLS lockdown (applied to prod 2026-06-26 via the management API).
--
-- The audit found ~48 public tables with permissive policies (many ALL:{public}:true
-- on dashboard_orders, inventory, purchasing_orders, customers, bom_*, financials).
-- Postgres's `public` role includes `anon` = the Supabase key shipped in the browser
-- bundle — so anyone could read/insert/update/DELETE the entire business database
-- directly, bypassing the (now fully gated) service-role API.
--
-- Fix: the anon + authenticated roles get NO writes and NO reads, EXCEPT the small
-- set of tables the browser legitimately reads directly via the anon/authenticated
-- supabase client (the permission matrix, quality inspections shown on floor
-- devices, priority overrides, and the BOM-final-assemblies used for label calc).
-- Everything else is reachable only through the service-role API (which bypasses
-- RLS) and the postgres superuser used by the Sheets->Supabase sync.
--
-- Verified: no client code writes via the anon/authenticated supabase client (all
-- writes go through the API); the only client-direct reads are the KEEP list below.

-- Writes: anon + authenticated never write directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated;

-- Reads: revoke all, then re-grant only the browser-read tables.
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon, authenticated;

GRANT SELECT ON public.role_permissions       TO anon, authenticated; -- use-permissions (UI gating; needed by device sessions too)
GRANT SELECT ON public.priority_overrides     TO anon, authenticated; -- lib/priority-overrides
GRANT SELECT ON public.bom_final_assemblies   TO anon, authenticated; -- lib/quality/bom-mappings (label calc)
GRANT SELECT ON public.qa_products            TO anon, authenticated; -- quality pages (floor devices = anon)
GRANT SELECT ON public.qa_hub_inspections     TO anon, authenticated;
GRANT SELECT ON public.qa_tire_inspections    TO anon, authenticated;
GRANT SELECT ON public.qa_finished_inspections TO anon, authenticated;
GRANT SELECT ON public.qa_audit_trail         TO anon, authenticated;

-- NOTE: the permissive ALL:{public}:true POLICIES still exist but are now moot for
-- anon/authenticated (no table grant => no access). A follow-up can DROP those
-- policies for cleanliness. service_role + postgres are unaffected.
