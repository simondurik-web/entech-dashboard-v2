-- Enable RLS on QA tables
ALTER TABLE qa_hub_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_tire_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_finished_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_audit_trail ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all QA data
CREATE POLICY "Authenticated users can read hub inspections" ON qa_hub_inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert hub inspections" ON qa_hub_inspections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update hub inspections" ON qa_hub_inspections FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read tire inspections" ON qa_tire_inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert tire inspections" ON qa_tire_inspections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update tire inspections" ON qa_tire_inspections FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read finished inspections" ON qa_finished_inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert finished inspections" ON qa_finished_inspections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update finished inspections" ON qa_finished_inspections FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read products" ON qa_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert products" ON qa_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update products" ON qa_products FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read audit trail" ON qa_audit_trail FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert audit trail" ON qa_audit_trail FOR INSERT TO authenticated WITH CHECK (true);

-- Also allow anon key to read (for server-side rendering)
CREATE POLICY "Anon can read hub inspections" ON qa_hub_inspections FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read tire inspections" ON qa_tire_inspections FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read finished inspections" ON qa_finished_inspections FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read products" ON qa_products FOR SELECT TO anon USING (true);
