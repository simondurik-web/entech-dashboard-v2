-- Scheduling Audit Log Table
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/mqfjmzqeccufqhisqpij/sql)

CREATE TABLE IF NOT EXISTS scheduling_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES scheduling_entries(id) ON DELETE SET NULL,
  employee_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'copy_week', 'revert_week')),
  changed_by TEXT,
  changed_by_email TEXT,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_employee ON scheduling_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_entry ON scheduling_audit_log(entry_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON scheduling_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON scheduling_audit_log(action);

ALTER TABLE scheduling_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduling_audit_select" ON scheduling_audit_log FOR SELECT USING (true);
CREATE POLICY "scheduling_audit_insert" ON scheduling_audit_log FOR INSERT WITH CHECK (true);
