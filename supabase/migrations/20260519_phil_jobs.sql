-- Phil Assistant — async job queue
--
-- Decouples the chat round-trip from any wall-clock timeout. Vercel POST
-- creates a job here, immediately returns an SSE stream that polls this
-- table. The Mac mini bridge runs a worker thread that polls for queued
-- jobs, claims one with `FOR UPDATE SKIP LOCKED`, runs the codex pipeline,
-- and writes the result back.
--
-- No timeout on the bridge side beyond per-codex (200s) — Phil can grind
-- through 4 SQL iterations + a 100+-row report without hitting any
-- Vercel-side ceiling, because the Vercel function ends in seconds once it
-- finishes streaming poll events.

create table if not exists public.phil_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null,
  question     text not null,
  history      jsonb,                              -- pre-loaded chat turns
  language     text not null check (language in ('en','es')),
  user_email   text,                               -- snapshotted for prompt
  user_role    text,
  status       text not null default 'queued'
               check (status in ('queued','running','done','failed')),
  result       jsonb,                              -- {answer, report?, model, latencyMs, codexCalls, queriesRun}
  error        text,
  claimed_by   text,                               -- bridge instance hostname or pid
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- Worker polling — finds queued jobs in FIFO order.
create index if not exists phil_jobs_status_created_idx
  on public.phil_jobs (status, created_at);

-- Client polling — Vercel SSE polls by id; this index speeds the per-job lookup.
create index if not exists phil_jobs_user_session_idx
  on public.phil_jobs (user_id, session_id, created_at desc);

-- Safety: stale "running" jobs (worker crashed mid-flight) should be reclaimable.
-- We don't auto-reclaim in SQL; the worker checks `claimed_at < now() - 10min`
-- on the next poll cycle and re-queues. The index above covers that filter.

alter table public.phil_jobs enable row level security;

-- Users can read their own jobs (frontend SSE polls don't go through here, but
-- this stays consistent with phil_chat_history's RLS model).
create policy phil_jobs_select_own
  on public.phil_jobs for select
  using (auth.uid() = user_id);

-- Users can insert jobs for themselves. The Vercel route uses supabaseAdmin
-- (service role) which bypasses RLS — but if a future direct-from-client path
-- ever exists, this gates it correctly.
create policy phil_jobs_insert_own
  on public.phil_jobs for insert
  with check (auth.uid() = user_id);

-- No update / delete policies → only service role (Vercel + bridge worker)
-- can write back results. Defense in depth.

comment on table public.phil_jobs is
  'Phil Assistant async job queue. Decouples chat round-trip from wall-clock '
  'timeouts. Vercel inserts queued jobs; Mac mini bridge worker claims + runs + '
  'writes result back; Vercel SSE polls for completion. RLS: users see own '
  'rows, writes via service role only.';
