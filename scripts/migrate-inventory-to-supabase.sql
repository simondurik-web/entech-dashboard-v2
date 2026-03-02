-- Migration: Create inventory_reference and inventory_history tables
-- Run this in Supabase SQL Editor

-- 1. Reference data (costs, departments, descriptions)
CREATE TABLE IF NOT EXISTS inventory_reference (
  fusion_id TEXT PRIMARY KEY,
  description TEXT DEFAULT '',
  netsuite_id TEXT DEFAULT '',
  category TEXT DEFAULT '',
  department TEXT DEFAULT '',
  sub_department TEXT DEFAULT '',
  cost NUMERIC(12,2),
  lower_cost NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  customer_vendor TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Inventory history (one row per part per date)
CREATE TABLE IF NOT EXISTS inventory_history (
  id BIGSERIAL PRIMARY KEY,
  part_number TEXT NOT NULL,
  date DATE NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(part_number, date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_inventory_history_part ON inventory_history(part_number);
CREATE INDEX IF NOT EXISTS idx_inventory_history_date ON inventory_history(date);
CREATE INDEX IF NOT EXISTS idx_inventory_reference_dept ON inventory_reference(department);

-- Enable RLS but allow service role full access
ALTER TABLE inventory_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON inventory_reference
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON inventory_history
  FOR ALL USING (true) WITH CHECK (true);

-- Allow anon read access (dashboard is public)
CREATE POLICY "Public read access" ON inventory_reference
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON inventory_history
  FOR SELECT USING (true);
