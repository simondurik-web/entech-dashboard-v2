-- BOM Individual Items
CREATE TABLE IF NOT EXISTS bom_individual_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number text UNIQUE NOT NULL,
  description text,
  cost_per_unit numeric(12,6) NOT NULL DEFAULT 0,
  unit text DEFAULT 'lb',
  supplier text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- BOM Sub Assembly
CREATE TABLE IF NOT EXISTS bom_sub_assemblies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number text UNIQUE NOT NULL,
  category text,
  mold_name text,
  part_weight numeric(10,4),
  parts_per_hour numeric(10,2),
  labor_rate_per_hour numeric(10,2) DEFAULT 29.25,
  num_employees numeric(4,1) DEFAULT 1,
  material_cost numeric(12,6) DEFAULT 0,
  labor_cost_per_part numeric(12,6) DEFAULT 0,
  overhead_cost numeric(12,6) DEFAULT 0,
  total_cost numeric(12,6) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Sub assembly components
CREATE TABLE IF NOT EXISTS bom_sub_assembly_components (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sub_assembly_id uuid REFERENCES bom_sub_assemblies(id) ON DELETE CASCADE,
  component_part_number text NOT NULL,
  quantity numeric(12,6) NOT NULL,
  quantity_formula text,
  cost numeric(12,6) DEFAULT 0,
  is_scrap boolean DEFAULT false,
  scrap_rate numeric(6,4),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- BOM Final Assembly
CREATE TABLE IF NOT EXISTS bom_final_assemblies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number text UNIQUE NOT NULL,
  product_category text,
  sub_product_category text,
  description text,
  notes text,
  parts_per_package integer,
  parts_per_hour numeric(10,2),
  labor_rate_per_hour numeric(10,2) DEFAULT 29.25,
  num_employees numeric(4,1) DEFAULT 1,
  labor_cost_per_part numeric(12,6) DEFAULT 0,
  shipping_labor_cost numeric(12,6) DEFAULT 0,
  subtotal_cost numeric(12,6) DEFAULT 0,
  overhead_pct numeric(6,4) DEFAULT 0.0191,
  overhead_cost numeric(12,6) DEFAULT 0,
  admin_pct numeric(6,4) DEFAULT 0.1128,
  admin_cost numeric(12,6) DEFAULT 0,
  depreciation_pct numeric(6,4) DEFAULT 0.1055,
  depreciation_cost numeric(12,6) DEFAULT 0,
  repairs_pct numeric(6,4) DEFAULT 0.0658,
  repairs_cost numeric(12,6) DEFAULT 0,
  variable_cost numeric(12,6) DEFAULT 0,
  total_cost numeric(12,6) DEFAULT 0,
  profit_target_pct numeric(6,4) DEFAULT 0.20,
  profit_amount numeric(12,6) DEFAULT 0,
  sales_target numeric(12,6) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Final assembly components
CREATE TABLE IF NOT EXISTS bom_final_assembly_components (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  final_assembly_id uuid REFERENCES bom_final_assemblies(id) ON DELETE CASCADE,
  component_part_number text NOT NULL,
  component_source text NOT NULL,
  quantity numeric(12,6) NOT NULL,
  quantity_formula text,
  cost numeric(12,6) DEFAULT 0,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- BOM Config
CREATE TABLE IF NOT EXISTS bom_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text UNIQUE NOT NULL,
  value numeric(12,6) NOT NULL,
  label text,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- RLS policies
ALTER TABLE bom_individual_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_sub_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_sub_assembly_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_final_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_final_assembly_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_config ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY IF NOT EXISTS "public_read" ON bom_individual_items FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public_read" ON bom_sub_assemblies FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public_read" ON bom_sub_assembly_components FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public_read" ON bom_final_assemblies FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public_read" ON bom_final_assembly_components FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public_read" ON bom_config FOR SELECT USING (true);

-- Service role write (all operations)
CREATE POLICY IF NOT EXISTS "service_write" ON bom_individual_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_write" ON bom_sub_assemblies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_write" ON bom_sub_assembly_components FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_write" ON bom_final_assemblies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_write" ON bom_final_assembly_components FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_write" ON bom_config FOR ALL USING (true) WITH CHECK (true);

-- Seed bom_config
INSERT INTO bom_config (key, value, label, description) VALUES
  ('overhead_pct', 0.0191, 'Overhead %', 'Factory overhead allocation'),
  ('admin_pct', 0.1128, 'Administrative Expense %', 'Admin and office costs'),
  ('depreciation_pct', 0.1055, 'Depreciation %', 'Equipment depreciation'),
  ('repairs_pct', 0.0658, 'Repairs & Supplies COGS %', 'Maintenance and supplies'),
  ('profit_target_pct', 0.20, 'Profit Target %', 'Default profit margin target'),
  ('labor_rate_base', 25, 'Base Labor Rate $/hr', 'Before benefits multiplier'),
  ('labor_benefits_multiplier', 1.17, 'Benefits Multiplier', 'Applied to base labor rate')
ON CONFLICT (key) DO NOTHING;
