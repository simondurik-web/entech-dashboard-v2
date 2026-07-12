-- MCP server tables (2026-07-11). Additive only — safe to re-run.
-- All tables live in public schema (PostgREST-exposed) with RLS enabled and NO
-- policies: anon/authenticated get empty results, service_role bypasses RLS.
-- App access goes exclusively through supabaseAdmin in API routes.

create table if not exists public.mcp_access (
  user_id uuid primary key,
  email text not null unique,
  enabled boolean not null default true,
  -- Permission level. v1 grants everyone full_read; production_only /
  -- financial are pre-declared so adding tiers later is data, not DDL.
  scope text not null default 'full_read'
    check (scope in ('full_read', 'production_only', 'financial')),
  granted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Global kill switch (single row, id always 1).
create table if not exists public.mcp_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.mcp_settings (id, enabled) values (1, true)
on conflict (id) do nothing;

-- Dynamically-registered OAuth clients (Gemini, ChatGPT, Grok, Claude, …).
create table if not exists public.mcp_oauth_clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text,
  redirect_uris jsonb not null,
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

-- Authorization codes (PKCE). Stored hashed; single-use; 10-min expiry.
create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  client_id uuid not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null,
  email text not null,
  scope text not null,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Refresh tokens. Stored hashed; rotated on every use.
create table if not exists public.mcp_oauth_tokens (
  token_hash text primary key,
  client_id uuid not null,
  user_id uuid not null,
  email text not null,
  scope text not null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every MCP request (and auth failure) — the audit trail.
create table if not exists public.mcp_request_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  email text,
  user_id uuid,
  client_id uuid,
  method text not null,
  tool text,
  args jsonb,
  ok boolean not null,
  error text,
  latency_ms int
);
create index if not exists mcp_request_log_ts_idx on public.mcp_request_log (ts desc);

-- Belt-and-suspenders for the pre-existing codex_reader role (behind
-- /api/codex-query): keep auth/token/device tables out of its reach even
-- though the MCP query tool no longer uses it.
revoke select on
  public.mcp_access,
  public.mcp_settings,
  public.mcp_oauth_clients,
  public.mcp_oauth_codes,
  public.mcp_oauth_tokens,
  public.mcp_request_log,
  public.authorized_devices
from codex_reader;

-- ── Dedicated role for the MCP run_query tool ──────────────────────────────
-- The MCP free-form-SQL tool connects to the Supabase pooler AUTHENTICATING
-- DIRECTLY AS THIS ROLE (username "mcp_query_reader.<projectref>"), NOT as
-- postgres. That closes a privilege-escalation class: when the session role is
-- postgres and you only `SET LOCAL ROLE`, a query can call
-- set_config('role','postgres',true) and read revoked tables. As a role that
-- is a member of nothing, that SET ROLE is denied outright.
--
--   password: rotate via `alter role mcp_query_reader password '…'` and update
--             MCP_QUERY_DB_URL (Vercel + .env.local).
drop role if exists mcp_query_reader;
create role mcp_query_reader
  login nosuperuser nocreatedb nocreaterole noinherit bypassrls
  password 'SET_VIA_ALTER_ROLE_NOT_IN_SOURCE';

grant usage on schema public to mcp_query_reader;
-- Broad SELECT on tables that exist TODAY (Simon: "read everything incl.
-- financial + ERP"). Deliberately NO `alter default privileges` for this role,
-- so any FUTURE table is invisible until explicitly granted — fail-closed, so a
-- later table holding secrets can't silently become readable.
grant select on all tables in schema public to mcp_query_reader;

-- Wall off auth / token / PII / audit / OTP tables from free-form SQL.
-- bypassrls means the SELECT grant is the ONLY boundary — this list is it.
revoke select on
  public.mcp_access, public.mcp_settings, public.mcp_oauth_clients,
  public.mcp_oauth_codes, public.mcp_oauth_tokens, public.mcp_request_log,
  public.authorized_devices, public.molding_login_otp_throttle,
  public.snappad_login_otp_throttle, public.user_profiles, public.users,
  public.user_app_roles, public.phil_chat_history, public.phil_jobs,
  public.push_subscriptions, public.api_audit_log
from mcp_query_reader;

-- Views run with their owner's rights, so a view over a walled table would
-- leak it despite the base-table revoke. phil_chat_user_stats joins
-- phil_chat_history + user_profiles (emails, names) — revoke it too. Re-scan
-- for new such views whenever a view is added:
--   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relkind in ('v','m')
--     and has_table_privilege('mcp_query_reader', c.oid, 'SELECT')
--     and pg_get_viewdef(c.oid) ~* '(user_profiles|phil_chat|oauth|otp_throttle|
--         authorized_devices|api_audit_log|push_subscription|mcp_)';
revoke select on public.phil_chat_user_stats from mcp_query_reader;

alter table public.mcp_access enable row level security;
alter table public.mcp_settings enable row level security;
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
alter table public.mcp_request_log enable row level security;
