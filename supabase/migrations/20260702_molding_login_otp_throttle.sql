-- Rate-limit table for the passwordless login-CODE flow (app/api/auth/otp/start).
--
-- That route uses admin generateLink + Resend directly, which BYPASSES Supabase's
-- global 30/hr email cap, so we throttle ourselves: per-email 45s cooldown +
-- per-IP sliding window (IP rows key on an "ip:" prefix in the same `email`
-- column, which can't collide with a real address). Service-role only; RLS on
-- with no policies so anon/authenticated get nothing.
create table if not exists public.molding_login_otp_throttle (
  email        text primary key,
  sent_count   integer not null default 0,
  window_start timestamptz,
  last_sent_at timestamptz
);

alter table public.molding_login_otp_throttle enable row level security;

revoke all on public.molding_login_otp_throttle from anon, authenticated;
grant all on public.molding_login_otp_throttle to service_role;

comment on table public.molding_login_otp_throttle is
  'Rate-limit state for the Molding Dashboard login-code flow (/api/auth/otp/start). Per-email cooldown + per-IP window (ip: prefixed rows). Service-role only.';
