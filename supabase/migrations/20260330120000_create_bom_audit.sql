CREATE TABLE IF NOT EXISTS bom_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type text NOT NULL,  -- 'individual_item', 'sub_assembly', 'final_assembly'
  entity_id uuid NOT NULL,
  action text NOT NULL,  -- 'created', 'updated', 'deleted', 'duplicated'
  field_name text,
  old_value text,
  new_value text,
  performed_by_name text,
  performed_by_email text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_bom_audit_entity ON bom_audit(entity_type, entity_id);
CREATE INDEX idx_bom_audit_created ON bom_audit(created_at DESC);

ALTER TABLE bom_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON bom_audit FOR ALL USING (true) WITH CHECK (true);
