-- Phil Assistant — chat history persisted per user
-- Multi-turn conversations grouped by session_id.
-- RLS: users see only their own messages; service role (admin) sees all.

create table if not exists public.phil_chat_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null,
  model        text,
  latency_ms   integer,
  report       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists phil_chat_history_user_created_idx
  on public.phil_chat_history (user_id, created_at desc);

create index if not exists phil_chat_history_session_idx
  on public.phil_chat_history (session_id, created_at asc);

alter table public.phil_chat_history enable row level security;

-- Users can read their own history
create policy phil_chat_select_own
  on public.phil_chat_history
  for select
  using (auth.uid() = user_id);

-- Users can insert their own messages
create policy phil_chat_insert_own
  on public.phil_chat_history
  for insert
  with check (auth.uid() = user_id);

-- Users can delete their own messages (clear history)
create policy phil_chat_delete_own
  on public.phil_chat_history
  for delete
  using (auth.uid() = user_id);

-- Admin view: per-user activity summary
-- Service role queries this directly via supabaseAdmin.
-- The view aggregates personal data (emails, names, message counts) across
-- all users, so we revoke direct access from anon/authenticated and only
-- grant select to service_role. Admin pages read via the service-role key.
create or replace view public.phil_chat_user_stats as
select
  p.user_id,
  up.email,
  up.full_name,
  count(*)                                                    as total_messages,
  count(*) filter (where p.role = 'user')                     as questions_asked,
  count(*) filter (where p.role = 'assistant')                as answers_given,
  count(*) filter (where p.report is not null)                as reports_generated,
  count(*) filter (where p.created_at > now() - interval '24 hours') as messages_24h,
  count(*) filter (where p.created_at > now() - interval '7 days')   as messages_7d,
  min(p.created_at)                                           as first_message_at,
  max(p.created_at)                                           as last_message_at
from public.phil_chat_history p
left join public.user_profiles up on up.id = p.user_id
group by p.user_id, up.email, up.full_name;

revoke all on public.phil_chat_user_stats from anon, authenticated, public;
grant select on public.phil_chat_user_stats to service_role;

comment on table public.phil_chat_history is
  'Per-user multi-turn chat history for the Phil Assistant (GPT-5.5 via local bridge). RLS-gated to own user; admin reads via service role.';
comment on view public.phil_chat_user_stats is
  'Admin-only summary of Phil usage per user. Service-role read access only; revoked from anon/authenticated to prevent leaking other users emails + counts.';
