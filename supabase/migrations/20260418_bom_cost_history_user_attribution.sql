-- Migration: BOM Cost History — user attribution columns
-- Date: 2026-04-18
-- Depends on: 20260416_bom_cost_tracking_triggers_views.sql
--
-- The trigger-based bom_cost_history.changed_by captures the Postgres role
-- (service_role, postgres, migration_backfill) rather than the actual user.
-- Add explicit columns that API routes fill in after the UPDATE completes,
-- scoped to the request's time window. Backfill of old rows stays NULL.

ALTER TABLE bom_cost_history
  ADD COLUMN IF NOT EXISTS changed_by_email text,
  ADD COLUMN IF NOT EXISTS changed_by_name  text;

-- Recreate the details view so the API can SELECT these columns.
-- Postgres REPLACE won't reorder columns, so drop-and-recreate.
DROP VIEW IF EXISTS bom_cost_history_with_details;
CREATE VIEW bom_cost_history_with_details AS
SELECT
  h.id,
  h.bom_item_id,
  h.item_type,
  h.changed_field,
  h.old_value,
  h.new_value,
  h.changed_by,
  h.changed_by_email,
  h.changed_by_name,
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
