-- Add mold_cavity column to qa_hub_inspections
-- Tracks which injection mold cavity (1-4) produced the hub
ALTER TABLE qa_hub_inspections ADD COLUMN IF NOT EXISTS mold_cavity integer;
ALTER TABLE qa_hub_inspections ADD CONSTRAINT qa_hub_inspections_mold_cavity_check CHECK (mold_cavity >= 1 AND mold_cavity <= 4);
