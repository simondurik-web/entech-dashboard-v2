CREATE INDEX IF NOT EXISTS idx_bom_sub_assembly_components_sub_assembly_id
  ON public.bom_sub_assembly_components(sub_assembly_id);

CREATE INDEX IF NOT EXISTS idx_bom_final_assembly_components_final_assembly_id
  ON public.bom_final_assembly_components(final_assembly_id);

CREATE INDEX IF NOT EXISTS idx_bom_final_assembly_components_source_part
  ON public.bom_final_assembly_components(component_source, component_part_number);

UPDATE public.bom_final_assembly_components
SET component_source = 'individual_item'
WHERE component_source = 'individual';

ALTER TABLE public.bom_final_assembly_components
  DROP CONSTRAINT IF EXISTS bom_final_assembly_components_component_source_check;

ALTER TABLE public.bom_final_assembly_components
  ADD CONSTRAINT bom_final_assembly_components_component_source_check
  CHECK (component_source IN ('sub_assembly', 'individual_item'));
