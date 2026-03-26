CREATE TABLE IF NOT EXISTS qa_audit_trail (
    id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT NOT NULL,
    changed_by_email TEXT,
    change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_table_record ON qa_audit_trail(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON qa_audit_trail(created_at);
