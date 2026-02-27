-- Scheduling System Migration
-- Created: 2026-02-27

-- ==========================================
-- 1. EMPLOYEES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.scheduling_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  department text NOT NULL DEFAULT 'Molding',
  default_shift integer NOT NULL DEFAULT 1,
  shift_length numeric DEFAULT 10,
  pay_rate numeric,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ==========================================
-- 2. MACHINES / TASKS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.scheduling_machines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  department text DEFAULT 'Molding',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ==========================================
-- 3. SHIFT DEFAULTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.scheduling_shift_defaults (
  id integer PRIMARY KEY,
  label text NOT NULL,
  label_es text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL
);

INSERT INTO public.scheduling_shift_defaults (id, label, label_es, start_time, end_time) VALUES
  (1, 'Day Shift', 'Turno de Día', '07:00', '17:30'),
  (2, 'Night Shift', 'Turno de Noche', '17:30', '04:30')
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- 4. SCHEDULE ENTRIES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.scheduling_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text NOT NULL REFERENCES public.scheduling_employees(employee_id) ON DELETE CASCADE,
  date date NOT NULL,
  shift integer NOT NULL DEFAULT 1,
  start_time time NOT NULL DEFAULT '07:00',
  end_time time NOT NULL DEFAULT '17:30',
  machine_id uuid REFERENCES public.scheduling_machines(id) ON DELETE SET NULL,
  hours numeric,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);

-- ==========================================
-- 5. INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_sched_entries_date ON public.scheduling_entries(date);
CREATE INDEX IF NOT EXISTS idx_sched_entries_employee ON public.scheduling_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_sched_entries_employee_date ON public.scheduling_entries(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_sched_employees_active ON public.scheduling_employees(is_active);
CREATE INDEX IF NOT EXISTS idx_sched_employees_dept ON public.scheduling_employees(department);

-- ==========================================
-- 6. RLS POLICIES
-- ==========================================
ALTER TABLE public.scheduling_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_shift_defaults ENABLE ROW LEVEL SECURITY;

-- Shift defaults: everyone can read
CREATE POLICY "Anyone can read shift defaults" ON public.scheduling_shift_defaults
  FOR SELECT USING (true);

-- Employees: authenticated users can read (pay_rate filtered at API level)
CREATE POLICY "Authenticated users can read employees" ON public.scheduling_employees
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage employees" ON public.scheduling_employees
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- Machines: everyone reads, admins/managers/group_leaders write
CREATE POLICY "Anyone can read machines" ON public.scheduling_machines
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Leaders can manage machines" ON public.scheduling_machines
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'group_leader'))
  );

-- Entries: everyone reads, admins/managers/group_leaders write
CREATE POLICY "Anyone can read entries" ON public.scheduling_entries
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Leaders can manage entries" ON public.scheduling_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'group_leader'))
  );

-- ==========================================
-- 7. SEED MACHINES (from Google Sheet "Planing" tab)
-- ==========================================
INSERT INTO public.scheduling_machines (name, department, sort_order) VALUES
  ('Eco border south', 'Molding', 1),
  ('Eco border North', 'Molding', 2),
  ('H1 three ring', 'Molding', 3),
  ('H2 Curbs', 'Molding', 4),
  ('H3', 'Molding', 5),
  ('Material handler', 'Molding', 6),
  ('HA', 'Molding', 7),
  ('Snap pad shuttle press', 'Molding', 8),
  ('Plastic injection presses', 'Molding', 9),
  ('RT Blue line', 'Molding', 10),
  ('RT Green Line', 'Molding', 11),
  ('Hubing presses', 'Molding', 12),
  ('Rotating hubbing press', 'Molding', 13),
  ('308/261 hubing line', 'Molding', 14),
  ('Limpieza boom lift', 'Molding', 15),
  ('Limpieza general 1', 'Molding', 16),
  ('Limpieza general 2', 'Molding', 17),
  ('Clavos', 'Molding', 18),
  ('Packaging', 'Molding', 19),
  ('Press 28', 'Molding', 20),
  ('Extruder', 'Molding', 21)
ON CONFLICT DO NOTHING;

-- ==========================================
-- 8. AUTO-CALCULATE HOURS TRIGGER
-- ==========================================
CREATE OR REPLACE FUNCTION public.calculate_scheduling_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_time > NEW.start_time THEN
    NEW.hours := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600;
  ELSE
    -- Cross-midnight shift (e.g. 17:30 to 04:30)
    NEW.hours := EXTRACT(EPOCH FROM (('24:00:00'::time - NEW.start_time) + NEW.end_time)) / 3600;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calculate_hours
  BEFORE INSERT OR UPDATE ON public.scheduling_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_scheduling_hours();
