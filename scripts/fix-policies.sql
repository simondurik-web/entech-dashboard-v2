DO $$ 
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_individual_items','bom_sub_assemblies','bom_sub_assembly_components','bom_final_assemblies','bom_final_assembly_components','bom_config']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS public_read ON %I', t);
    EXECUTE format('CREATE POLICY public_read ON %I FOR SELECT USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS service_write ON %I', t);
    EXECUTE format('CREATE POLICY service_write ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
