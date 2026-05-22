-- Codex read-only role.
--
-- Dedicated Postgres role for the external Codex automation agent. The
-- Next.js /api/codex-query endpoint connects as this role so even a bug
-- in the SQL validator can't escalate to writes — the role itself only
-- has SELECT.
--
-- Tables that are walled off (sensitive / not useful to Codex):
--   api_audit_log         — security audit (don't let API readers see it)
--   phil_chat_history     — user chat content
--   phil_jobs             — user chat queue
--   user_profiles, users, user_app_roles — auth/PII
--   push_subscriptions    — FCM device tokens
--
-- Everything else in public is SELECT-able. Default privileges keep new
-- tables in scope automatically — no migration tweak needed when adding
-- a new table unless it should be walled off (then REVOKE explicitly).
--
-- Password set out-of-band via the env var CODEX_READER_DB_URL on Vercel.
-- This migration is idempotent — safe to re-run.

-- Create the role (no-op if it already exists).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'codex_reader') then
    create role codex_reader login password 'set-via-alter';
  end if;
end $$;

-- Enforce a hard query timeout at the role level — even if the Node side
-- forgets to set one, the DB will cut off after 10s.
alter role codex_reader set statement_timeout = '10s';
alter role codex_reader set search_path = public, pg_catalog;

-- Connect + schema usage
grant connect on database postgres to codex_reader;
grant usage on schema public to codex_reader;

-- Bulk grant SELECT on every current public table
grant select on all tables in schema public to codex_reader;

-- Default privileges: any NEW table created in `public` by the `postgres`
-- role (Supabase migrations run as this role) automatically gets SELECT
-- to codex_reader. No future migration changes required.
alter default privileges for role postgres in schema public
  grant select on tables to codex_reader;

-- Wall off the sensitive tables — revoke after the bulk grant
revoke select on table public.api_audit_log         from codex_reader;
revoke select on table public.phil_chat_history     from codex_reader;
revoke select on table public.phil_jobs             from codex_reader;
revoke select on table public.user_profiles         from codex_reader;
revoke select on table public.users                 from codex_reader;
revoke select on table public.user_app_roles        from codex_reader;
revoke select on table public.push_subscriptions    from codex_reader;

-- Information_schema is readable by every role by default. The Codex
-- schema-discovery endpoint relies on that for `tables` + `columns`.
