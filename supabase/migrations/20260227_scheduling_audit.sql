-- Scheduling audit log for tracking all schedule changes
CREATE TABLE IF NOT EXISTS scheduling_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES scheduling_entries(id) ON DELETE SET NULL,
  employee_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'copy_week', 'revert_week')),
  changed_by TEXT, -- user_id of who made the change
  changed_by_email TEXT, -- email for display
  field_changed TEXT, -- which field changed (null for create/delete)
  old_value TEXT,
  new_value TEXT,
  metadata JSONB DEFAULT '{}', -- extra context (e.g. copy_week source dates)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_audit_employee ON scheduling_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_entry ON scheduling_audit_log(entry_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON scheduling_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON scheduling_audit_log(action);

-- RLS
ALTER TABLE scheduling_audit_log ENABLE ROW LEVEL SECURITY;

-- Anyone can read audit logs (transparency)
CREATE POLICY "scheduling_audit_select" ON scheduling_audit_log
  FOR SELECT USING (true);

-- Only service role can insert (via API)
CREATE POLICY "scheduling_audit_insert" ON scheduling_audit_log
  FOR INSERT WITH CHECK (true);
