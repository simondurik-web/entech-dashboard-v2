-- Per-line staging locks: serialize the destructive phase of staging/assign so
-- two stations can't both pass the capacity check for the same release line,
-- release their source reservations, and strand the loser's pallet unreserved
-- under a new code (codex review residual, approved by Simon 2026-07-20).
--
-- Lease semantics, not pg advisory locks: the protected phase is a chain of
-- ERPNext HTTP calls, and PostgREST can't hold an advisory lock across
-- requests. A crashed holder self-expires via TTL (> the route's 120s
-- maxDuration), so no janitor is needed.

create table if not exists public.staging_line_locks (
  line_key text primary key, -- '<soName>' or '<soName>:<salesOrderItem>'
  holder text not null,      -- the op's idempotency key (re-entrant for retries)
  expires_at timestamptz not null
);

-- Deny-all: only the service role (which bypasses RLS) and the definer
-- functions below touch this table.
alter table public.staging_line_locks enable row level security;

-- Atomic claim: insert, or take over an EXPIRED lease. No same-holder
-- re-entry: holders are unique per REQUEST (see line-lock.ts) — re-entry let a
-- duplicate request's cleanup delete the lease out from under the original,
-- opening the line to a third request mid-mutation (codex/grok lock-review
-- round 2). Returns true when the lock is held after the call, else false.
create or replace function public.claim_staging_line_lock(
  p_key text,
  p_holder text,
  p_ttl_seconds int
) returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    insert into staging_line_locks (line_key, holder, expires_at)
    values (p_key, p_holder, now() + make_interval(secs => p_ttl_seconds))
    on conflict (line_key) do update
      set holder = excluded.holder,
          expires_at = excluded.expires_at
      where staging_line_locks.expires_at < now()
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.release_staging_line_lock(
  p_key text,
  p_holder text
) returns void
language sql
security definer
set search_path = public
as $$
  delete from staging_line_locks
  where line_key = p_key and holder = p_holder;
$$;

-- The definer functions are the only intended entry points; keep them away
-- from anon/authenticated PostgREST callers.
revoke execute on function public.claim_staging_line_lock(text, text, int) from public, anon, authenticated;
revoke execute on function public.release_staging_line_lock(text, text) from public, anon, authenticated;
grant execute on function public.claim_staging_line_lock(text, text, int) to service_role;
grant execute on function public.release_staging_line_lock(text, text) to service_role;
