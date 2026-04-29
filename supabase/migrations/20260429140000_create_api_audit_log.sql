-- API audit log for the public read-only price-lookup endpoint.
-- Captures every request (auth result, params, response classification, latency)
-- so Phil can review what the external Codex agent has been querying.
-- Never log the API key itself; only the query params + outcome.

CREATE TABLE IF NOT EXISTS public.api_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  endpoint text NOT NULL,
  caller_ip text,
  caller_user_agent text,
  query_params jsonb,
  result text NOT NULL,         -- 'found' | 'not_found' | 'unauthorized' | 'bad_request' | 'method_not_allowed' | 'server_error'
  response_time_ms integer,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_api_audit_log_created_at ON public.api_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_audit_log_result ON public.api_audit_log (result);

ALTER TABLE public.api_audit_log ENABLE ROW LEVEL SECURITY;

-- Anon role may INSERT only (the route uses the anon Supabase client).
-- No SELECT/UPDATE/DELETE for anon — log review goes through Supabase Studio
-- (service_role) or an authenticated dashboard role.
CREATE POLICY "anon_insert_api_audit_log"
  ON public.api_audit_log
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Service role retains full access by default (RLS bypassed).
