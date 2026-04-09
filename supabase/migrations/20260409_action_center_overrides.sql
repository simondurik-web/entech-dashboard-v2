-- ============================================================
-- RollTech Action Center — Phase 1: Override Write Table
-- Migration: 20260409_action_center_overrides.sql
--
-- Append-only audit log of bucket overrides performed via the
-- dashboard. The queue view will LEFT JOIN on this table to
-- surface the latest override per thread_key.
-- ============================================================

CREATE TABLE IF NOT EXISTS work_email.action_center_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_key      text NOT NULL,
  action_type     text NOT NULL,   -- target queue_bucket value
  performed_by    text NOT NULL,   -- 'dashboard:<user>' or 'system'
  performed_at    timestamptz NOT NULL DEFAULT now(),
  note            text,            -- optional free-text context
  previous_bucket text             -- snapshot of old bucket for audit
);

-- Fast lookup: latest override per thread
CREATE INDEX idx_overrides_thread_latest
  ON work_email.action_center_overrides (thread_key, performed_at DESC);

-- Timeline queries (dashboard audit log, reporting)
CREATE INDEX idx_overrides_performed_at
  ON work_email.action_center_overrides (performed_at DESC);

-- RLS: service_role bypasses by default, but enable RLS and add
-- an explicit policy for defense-in-depth.
ALTER TABLE work_email.action_center_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON work_email.action_center_overrides
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
