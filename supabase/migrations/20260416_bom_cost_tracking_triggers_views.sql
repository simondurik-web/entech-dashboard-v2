-- Migration: BOM Cost Tracking - Triggers and Views
-- Add automatic history tracking and analysis views
-- Date: 2026-04-16
-- Depends on: 20260415_bom_change_tracking.sql

-- ============================================
-- PHASE 3: Create triggers for automatic history tracking
-- ============================================

-- 1. Create trigger function for individual items
CREATE OR REPLACE FUNCTION track_individual_item_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cost_per_unit IS DISTINCT FROM NEW.cost_per_unit THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'individual', 'cost_per_unit', OLD.cost_per_unit, NEW.cost_per_unit, current_user);
  END IF;

  NEW.last_changed = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create trigger on bom_individual_items
DROP TRIGGER IF EXISTS track_individual_changes ON bom_individual_items;
CREATE TRIGGER track_individual_changes
BEFORE UPDATE ON bom_individual_items
FOR EACH ROW
EXECUTE FUNCTION track_individual_item_changes();

-- 3. Create trigger function for sub-assemblies
CREATE OR REPLACE FUNCTION track_sub_assembly_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.material_cost IS DISTINCT FROM NEW.material_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'sub', 'material_cost', OLD.material_cost, NEW.material_cost, current_user);
  END IF;

  IF OLD.labor_cost_per_part IS DISTINCT FROM NEW.labor_cost_per_part THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'sub', 'labor_cost_per_part', OLD.labor_cost_per_part, NEW.labor_cost_per_part, current_user);
  END IF;

  IF OLD.overhead_cost IS DISTINCT FROM NEW.overhead_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'sub', 'overhead_cost', OLD.overhead_cost, NEW.overhead_cost, current_user);
  END IF;

  IF OLD.total_cost IS DISTINCT FROM NEW.total_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'sub', 'total_cost', OLD.total_cost, NEW.total_cost, current_user);
  END IF;

  NEW.last_changed = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger on bom_sub_assemblies
DROP TRIGGER IF EXISTS track_sub_changes ON bom_sub_assemblies;
CREATE TRIGGER track_sub_changes
BEFORE UPDATE ON bom_sub_assemblies
FOR EACH ROW
EXECUTE FUNCTION track_sub_assembly_changes();

-- 5. Create trigger function for final assemblies
CREATE OR REPLACE FUNCTION track_final_assembly_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.labor_cost_per_part IS DISTINCT FROM NEW.labor_cost_per_part THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'labor_cost_per_part', OLD.labor_cost_per_part, NEW.labor_cost_per_part, current_user);
  END IF;

  IF OLD.subtotal_cost IS DISTINCT FROM NEW.subtotal_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'subtotal_cost', OLD.subtotal_cost, NEW.subtotal_cost, current_user);
  END IF;

  IF OLD.overhead_cost IS DISTINCT FROM NEW.overhead_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'overhead_cost', OLD.overhead_cost, NEW.overhead_cost, current_user);
  END IF;

  IF OLD.admin_cost IS DISTINCT FROM NEW.admin_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'admin_cost', OLD.admin_cost, NEW.admin_cost, current_user);
  END IF;

  IF OLD.depreciation_cost IS DISTINCT FROM NEW.depreciation_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'depreciation_cost', OLD.depreciation_cost, NEW.depreciation_cost, current_user);
  END IF;

  IF OLD.repairs_cost IS DISTINCT FROM NEW.repairs_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'repairs_cost', OLD.repairs_cost, NEW.repairs_cost, current_user);
  END IF;

  IF OLD.variable_cost IS DISTINCT FROM NEW.variable_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'variable_cost', OLD.variable_cost, NEW.variable_cost, current_user);
  END IF;

  IF OLD.total_cost IS DISTINCT FROM NEW.total_cost THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'final', 'total_cost', OLD.total_cost, NEW.total_cost, current_user);
  END IF;

  NEW.last_changed = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Create trigger on bom_final_assemblies
DROP TRIGGER IF EXISTS track_final_changes ON bom_final_assemblies;
CREATE TRIGGER track_final_changes
BEFORE UPDATE ON bom_final_assemblies
FOR EACH ROW
EXECUTE FUNCTION track_final_assembly_changes();

-- ============================================
-- PHASE 4: Create views for cost history analysis
-- ============================================

-- 1. View: Latest cost for each item/field
CREATE OR REPLACE VIEW bom_latest_costs AS
WITH ranked_costs AS (
  SELECT
    h.bom_item_id,
    h.item_type,
    h.changed_field,
    h.new_value,
    h.changed_at,
    ROW_NUMBER() OVER (PARTITION BY h.bom_item_id, h.item_type, h.changed_field ORDER BY h.changed_at DESC) as rn
  FROM bom_cost_history h
)
SELECT
  bom_item_id,
  item_type,
  changed_field,
  new_value,
  changed_at
FROM ranked_costs
WHERE rn = 1;

-- 2. View: Cost history with item details joined
CREATE OR REPLACE VIEW bom_cost_history_with_details AS
SELECT
  h.id,
  h.bom_item_id,
  h.item_type,
  h.changed_field,
  h.old_value,
  h.new_value,
  h.changed_by,
  h.changed_at,
  h.affected_assemblies,
  CASE
    WHEN h.item_type = 'individual' THEN i.part_number
    WHEN h.item_type = 'sub' THEN s.part_number
    WHEN h.item_type = 'final' THEN f.part_number
  END as part_number,
  CASE
    WHEN h.item_type = 'individual' THEN i.description
    WHEN h.item_type = 'sub' THEN s.category
    WHEN h.item_type = 'final' THEN f.description
  END as item_description
FROM bom_cost_history h
LEFT JOIN bom_individual_items i ON h.bom_item_id = i.id AND h.item_type = 'individual'
LEFT JOIN bom_sub_assemblies s ON h.bom_item_id = s.id AND h.item_type = 'sub'
LEFT JOIN bom_final_assemblies f ON h.bom_item_id = f.id AND h.item_type = 'final';

-- 3. View: Cost change statistics
CREATE OR REPLACE VIEW bom_cost_change_stats AS
WITH first_costs AS (
  SELECT
    bom_item_id,
    item_type,
    changed_field,
    new_value as first_value,
    ROW_NUMBER() OVER (PARTITION BY bom_item_id, item_type, changed_field ORDER BY changed_at ASC) as rn
  FROM bom_cost_history
),
last_costs AS (
  SELECT
    bom_item_id,
    item_type,
    changed_field,
    new_value as last_value,
    ROW_NUMBER() OVER (PARTITION BY bom_item_id, item_type, changed_field ORDER BY changed_at DESC) as rn
  FROM bom_cost_history
),
change_counts AS (
  SELECT
    bom_item_id,
    item_type,
    changed_field,
    COUNT(*) as total_changes
  FROM bom_cost_history
  GROUP BY bom_item_id, item_type, changed_field
)
SELECT
  fc.bom_item_id,
  fc.item_type,
  fc.changed_field,
  fc.first_value,
  lc.last_value,
  cc.total_changes,
  CASE
    WHEN fc.first_value != 0 THEN ROUND(((lc.last_value - fc.first_value) / fc.first_value * 100)::numeric, 2)
    ELSE NULL
  END as pct_change
FROM first_costs fc
JOIN last_costs lc ON
  fc.bom_item_id = lc.bom_item_id AND
  fc.item_type = lc.item_type AND
  fc.changed_field = lc.changed_field AND
  fc.rn = 1 AND lc.rn = 1
JOIN change_counts cc ON
  fc.bom_item_id = cc.bom_item_id AND
  fc.item_type = cc.item_type AND
  fc.changed_field = cc.changed_field;

-- 4. View: Recent cost changes (for dashboard widgets)
CREATE OR REPLACE VIEW bom_recent_cost_changes AS
SELECT
  h.id,
  h.bom_item_id,
  h.item_type,
  h.changed_field,
  h.old_value,
  h.new_value,
  h.changed_by,
  h.changed_at,
  CASE
    WHEN h.item_type = 'individual' THEN i.part_number
    WHEN h.item_type = 'sub' THEN s.part_number
    WHEN h.item_type = 'final' THEN f.part_number
  END as part_number,
  CASE
    WHEN h.item_type = 'individual' THEN i.description
    WHEN h.item_type = 'sub' THEN s.category
    WHEN h.item_type = 'final' THEN f.description
  END as description,
  CASE
    WHEN h.old_value IS NOT NULL THEN ROUND(((h.new_value - h.old_value) / h.old_value * 100)::numeric, 2)
    ELSE NULL
  END as pct_change
FROM bom_cost_history h
LEFT JOIN bom_individual_items i ON h.bom_item_id = i.id AND h.item_type = 'individual'
LEFT JOIN bom_sub_assemblies s ON h.bom_item_id = s.id AND h.item_type = 'sub'
LEFT JOIN bom_final_assemblies f ON h.bom_item_id = f.id AND h.item_type = 'final'
ORDER BY h.changed_at DESC
LIMIT 100;

-- ============================================
-- Notes
-- ============================================
-- This migration adds automatic cost change tracking for all BOM items.
-- Any UPDATE to tracked cost fields will automatically create a history record.
--
-- Tracked fields by table:
-- - bom_individual_items: cost_per_unit
-- - bom_sub_assemblies: material_cost, labor_cost_per_part, overhead_cost, total_cost
-- - bom_final_assemblies: labor_cost_per_part, subtotal_cost, overhead_cost, admin_cost,
--                        depreciation_cost, repairs_cost, variable_cost, total_cost
--
-- Views created for easy querying:
-- - bom_latest_costs: Current cost for each item/field
-- - bom_cost_history_with_details: Full history with item details
-- - bom_cost_change_stats: Analytics (first/last value, total changes, % change)
-- - bom_recent_cost_changes: Last 100 changes with % change (dashboard widget)
