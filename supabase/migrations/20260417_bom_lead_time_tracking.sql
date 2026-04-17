-- Migration: Extend individual-item change tracking to include lead_time
-- Date: 2026-04-17
-- Depends on: 20260416_bom_cost_tracking_triggers_views.sql
--
-- Motivation: The Cost Change Log view on BOM Explorer shows a unified
-- timeline of all cost AND lead time changes. Lead time is already numeric
-- so we record it into bom_cost_history with changed_field = 'lead_time'.

CREATE OR REPLACE FUNCTION track_individual_item_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cost_per_unit IS DISTINCT FROM NEW.cost_per_unit THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'individual', 'cost_per_unit', OLD.cost_per_unit, NEW.cost_per_unit, current_user);
  END IF;

  IF OLD.lead_time IS DISTINCT FROM NEW.lead_time THEN
    INSERT INTO bom_cost_history (bom_item_id, item_type, changed_field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'individual', 'lead_time', OLD.lead_time, NEW.lead_time, current_user);
  END IF;

  NEW.last_changed = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
