CREATE TABLE IF NOT EXISTS qa_products (
    id SERIAL PRIMARY KEY,
    product_type TEXT NOT NULL CHECK (product_type IN ('hub', 'tire', 'finished_product')),
    product_number TEXT NOT NULL UNIQUE,
    description TEXT,
    bore_size_target NUMERIC, bore_length_target NUMERIC, hub_diameter_target NUMERIC,
    weight_target NUMERIC, thickness_target NUMERIC, diameter_target NUMERIC,
    specs_json JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS qa_hub_inspections (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ, inspector_role TEXT, inspector_name TEXT,
    hub_number TEXT NOT NULL, hub_style TEXT,
    bore_size NUMERIC, bore_size_target NUMERIC,
    bore_length NUMERIC, bore_length_target NUMERIC,
    hub_diameter NUMERIC, hub_diameter_target NUMERIC,
    weight NUMERIC, weight_target NUMERIC,
    locking_mechanism TEXT, visual_inspection TEXT, comments TEXT, photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS qa_tire_inspections (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ, inspector_role TEXT, inspector_name TEXT,
    tire_number TEXT NOT NULL,
    thickness NUMERIC, thickness_target NUMERIC,
    diameter NUMERIC, diameter_target NUMERIC,
    weight NUMERIC, weight_target NUMERIC,
    visual_inspection TEXT, comments TEXT, photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS qa_finished_inspections (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ, inspector_role TEXT, inspector_name TEXT,
    rt_number TEXT NOT NULL,
    correct_tire TEXT, correct_hub TEXT, correct_hub_color TEXT,
    tire_od NUMERIC, tire_thickness NUMERIC, tire_weight NUMERIC,
    bore_check TEXT, locking_mechanism TEXT,
    tire_visual TEXT, hub_visual TEXT, comments TEXT, photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hub_insp_hub_number ON qa_hub_inspections(hub_number);
CREATE INDEX IF NOT EXISTS idx_hub_insp_timestamp ON qa_hub_inspections(timestamp);
CREATE INDEX IF NOT EXISTS idx_tire_insp_tire_number ON qa_tire_inspections(tire_number);
CREATE INDEX IF NOT EXISTS idx_tire_insp_timestamp ON qa_tire_inspections(timestamp);
CREATE INDEX IF NOT EXISTS idx_fp_insp_rt_number ON qa_finished_inspections(rt_number);
CREATE INDEX IF NOT EXISTS idx_fp_insp_timestamp ON qa_finished_inspections(timestamp);
