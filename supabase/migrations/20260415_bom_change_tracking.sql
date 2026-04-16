-- Migration: BOM Change Tracking - Phase 1
-- Add lead_time + last_changed columns, create bom_cost_history table
-- Date: 2026-04-15

-- 1. Add lead_time (individual items only) and last_changed to BOM tables

ALTER TABLE bom_individual_items
  ADD COLUMN IF NOT EXISTS lead_time integer,
  ADD COLUMN IF NOT EXISTS last_changed timestamptz DEFAULT now();

ALTER TABLE bom_sub_assemblies
  ADD COLUMN IF NOT EXISTS last_changed timestamptz DEFAULT now();

ALTER TABLE bom_final_assemblies
  ADD COLUMN IF NOT EXISTS last_changed timestamptz DEFAULT now();

-- 2. Backfill last_changed for existing rows
UPDATE bom_individual_items SET last_changed = now() WHERE last_changed IS NULL;
UPDATE bom_sub_assemblies SET last_changed = now() WHERE last_changed IS NULL;
UPDATE bom_final_assemblies SET last_changed = now() WHERE last_changed IS NULL;

-- 3. Create bom_cost_history table
CREATE TABLE IF NOT EXISTS bom_cost_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bom_item_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('individual', 'sub', 'final')),
  changed_field text NOT NULL,
  old_value numeric,
  new_value numeric,
  changed_by text,
  changed_at timestamptz DEFAULT now(),
  affected_assemblies jsonb DEFAULT '[]'::jsonb
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_bom_cost_history_item
  ON bom_cost_history(item_type, bom_item_id);

CREATE INDEX IF NOT EXISTS idx_bom_cost_history_changed_at
  ON bom_cost_history(changed_at DESC);

-- RLS policies
ALTER TABLE bom_cost_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bom_cost_history_read" ON bom_cost_history FOR SELECT USING (true);
CREATE POLICY "bom_cost_history_write" ON bom_cost_history FOR ALL USING (true) WITH CHECK (true);
