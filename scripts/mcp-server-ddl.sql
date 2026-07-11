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

alter table public.mcp_access enable row level security;
alter table public.mcp_settings enable row level security;
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
alter table public.mcp_request_log enable row level security;
