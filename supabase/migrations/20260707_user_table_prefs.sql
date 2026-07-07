-- Per-user, cross-device data-table column preferences (hidden columns + order),
-- keyed by the table's storageKey. Written only via /api/table-prefs with the
-- service-role client; RLS stays enabled with NO policies so anon/authenticated
-- PostgREST access is default-deny (same pattern as other server-only tables).
--
-- Applied to production 2026-07-07 (claude-3) — this file records the schema
-- for history/replays; CREATE IF NOT EXISTS keeps it idempotent.

CREATE TABLE IF NOT EXISTS public.user_table_prefs (
  user_id uuid NOT NULL,
  storage_key text NOT NULL,
  hidden_columns jsonb,
  column_order jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, storage_key)
);

ALTER TABLE public.user_table_prefs ENABLE ROW LEVEL SECURITY;
