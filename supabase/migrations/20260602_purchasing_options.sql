-- Dropdown option lists for the Purchasing form (Department, Sub Department,
-- people). Seeded from the sheet's "Reference data" tab; users can add new
-- options from the form (the "+ Add new" footer), mirroring the sheet's
-- "Add anything in a list" behavior.
CREATE TABLE IF NOT EXISTS purchasing_options (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  field text NOT NULL,            -- 'department' | 'sub_department' | 'person'
  value text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field, value)
);

CREATE INDEX IF NOT EXISTS idx_purchasing_options_field ON purchasing_options(field);

ALTER TABLE purchasing_options ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchasing_options_service_full') THEN
    CREATE POLICY purchasing_options_service_full ON purchasing_options FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
