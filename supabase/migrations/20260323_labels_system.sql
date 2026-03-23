-- ============================================================
-- Labels System — Phase 1: Database Schema
-- Migration: 20260323_labels_system.sql
-- ============================================================

-- 1. Labels table (stores generated label records)
CREATE TABLE IF NOT EXISTS labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_line TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  order_qty INTEGER NOT NULL,
  parts_per_package INTEGER NOT NULL DEFAULT 0,
  num_packages INTEGER NOT NULL DEFAULT 0,
  packaging_type TEXT,
  qr_data TEXT,
  label_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (label_status IN ('pending', 'generated', 'emailed', 'printed', 'error')),
  pdf_storage_path TEXT,
  assigned_to TEXT,
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ DEFAULT now(),
  emailed_to TEXT[],
  emailed_at TIMESTAMPTZ,
  printed_by UUID REFERENCES auth.users(id),
  printed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by order line and status
CREATE INDEX IF NOT EXISTS idx_labels_order_line ON labels(order_line);
CREATE INDEX IF NOT EXISTS idx_labels_status ON labels(label_status);
CREATE INDEX IF NOT EXISTS idx_labels_created ON labels(created_at DESC);

-- 2. Label settings table (replaces "Labels setup" sheet)
CREATE TABLE IF NOT EXISTS label_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Default settings
INSERT INTO label_settings (setting_key, setting_value) VALUES
  ('email_recipients', ''),
  ('auto_enabled', 'false'),
  ('last_processed_line', '0'),
  ('pdf_folder_name', 'Molding Labels PDFs')
ON CONFLICT (setting_key) DO NOTHING;

-- 3. Label activity log
CREATE TABLE IF NOT EXISTS label_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label_id UUID REFERENCES labels(id) ON DELETE SET NULL,
  order_line TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'error', 'skipped', 'info')),
  recipients TEXT,
  pdf_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_log_created ON label_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_label_log_line ON label_activity_log(order_line);

-- 4. Updated_at trigger for labels
CREATE OR REPLACE FUNCTION update_labels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS labels_updated_at ON labels;
CREATE TRIGGER labels_updated_at
  BEFORE UPDATE ON labels
  FOR EACH ROW
  EXECUTE FUNCTION update_labels_updated_at();

-- 5. RLS Policies
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_activity_log ENABLE ROW LEVEL SECURITY;

-- Labels: authenticated users can read; write requires auth
CREATE POLICY labels_select ON labels FOR SELECT TO authenticated USING (true);
CREATE POLICY labels_insert ON labels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY labels_update ON labels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Label settings: authenticated can read; write requires auth
CREATE POLICY label_settings_select ON label_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY label_settings_update ON label_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Label activity log: authenticated can read and insert
CREATE POLICY label_log_select ON label_activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY label_log_insert ON label_activity_log FOR INSERT TO authenticated WITH CHECK (true);

-- Service role bypass (for API routes)
CREATE POLICY labels_service ON labels FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY label_settings_service ON label_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY label_log_service ON label_activity_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. Add label_status to dashboard_orders if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dashboard_orders' AND column_name = 'label_status'
  ) THEN
    ALTER TABLE dashboard_orders ADD COLUMN label_status TEXT DEFAULT NULL;
  END IF;
END $$;

-- 7. Storage bucket for label PDFs (run via Supabase dashboard or API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('label-pdfs', 'label-pdfs', false)
-- ON CONFLICT (id) DO NOTHING;
