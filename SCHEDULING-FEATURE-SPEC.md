# Scheduling Feature — Full Spec

## Overview
Add a complete employee scheduling system to the Entech Dashboard v2.
Group leaders can assign/edit schedules, managers/admins see full history + pay rates,
regular employees see a simple forward-looking view of their own schedule.

## Data Source
Migrate from Google Sheet `1SqQeBkgzQPUqdMcOR-gIlPRk85renzqnV1bgn2C10lg` to Supabase.
After migration, the dashboard reads/writes ONLY from Supabase — no Google Sheets dependency.

## Database Schema (Supabase Migration)

### Table: `scheduling_employees`
```sql
CREATE TABLE scheduling_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text UNIQUE NOT NULL,        -- e.g. "1045"
  first_name text NOT NULL,
  last_name text NOT NULL,
  department text NOT NULL DEFAULT 'Molding',
  default_shift integer NOT NULL DEFAULT 1, -- 1=day, 2=night
  shift_length numeric DEFAULT 10,
  pay_rate numeric,                         -- hourly wage (sensitive)
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Table: `scheduling_machines`
```sql
CREATE TABLE scheduling_machines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  department text DEFAULT 'Molding',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

### Table: `scheduling_entries`
```sql
CREATE TABLE scheduling_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text NOT NULL REFERENCES scheduling_employees(employee_id),
  date date NOT NULL,
  shift integer NOT NULL,                    -- 1=day, 2=night
  start_time time NOT NULL DEFAULT '07:00',  -- customizable
  end_time time NOT NULL DEFAULT '17:30',    -- customizable
  machine_id uuid REFERENCES scheduling_machines(id),
  hours numeric GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
  ) STORED,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);
```

### Table: `scheduling_shift_defaults`
```sql
CREATE TABLE scheduling_shift_defaults (
  id integer PRIMARY KEY,                   -- 1=day, 2=night
  label text NOT NULL,
  label_es text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL
);
INSERT INTO scheduling_shift_defaults VALUES
  (1, 'Day Shift', 'Turno de Día', '07:00', '17:30'),
  (2, 'Night Shift', 'Turno de Noche', '17:30', '04:30');
```

### RLS Policies
- `scheduling_employees`: admins/managers read all (including pay_rate), group_leaders read all except pay_rate, regular users read own only
- `scheduling_entries`: admins/managers/group_leaders full CRUD, regular users SELECT only
- `scheduling_machines`: admins/managers/group_leaders full CRUD, regular users SELECT only
- Pay rate column: filtered at API level — only returned for admin/manager roles

### Indexes
```sql
CREATE INDEX idx_sched_entries_date ON scheduling_entries(date);
CREATE INDEX idx_sched_entries_employee ON scheduling_entries(employee_id);
CREATE INDEX idx_sched_entries_employee_date ON scheduling_entries(employee_id, date);
```

## API Routes

### `/api/scheduling/employees` (GET, POST, PUT, DELETE)
- GET: list employees (filter by department, active status)
- POST: add new employee
- PUT: update employee (pay_rate only for admin/manager)
- DELETE: soft-delete (set is_active=false)

### `/api/scheduling/entries` (GET, POST, PUT, DELETE)
- GET: list entries with filters (date range, employee_id, shift, department)
  - Query params: `from`, `to`, `employee_id`, `shift`, `department`
  - Joins employee name + machine name
- POST: create/upsert entry (upsert on employee_id+date unique)
  - Body: { employee_id, date, shift, start_time?, end_time?, machine_id? }
- PUT: update entry by id
- DELETE: remove entry by id
- **Bulk POST**: accept array of entries for batch assignment

### `/api/scheduling/machines` (GET, POST, PUT, DELETE)
- CRUD for machines/tasks
- GET returns sorted by sort_order, active first

### `/api/scheduling/hours` (GET) — ADMIN/MANAGER ONLY
- Returns hours + pay data for a date range
- Joins employee pay_rate × hours
- Grouped by employee, with weekly/monthly totals
- Response includes: employee_name, total_hours, regular_hours, ot_hours, pay_rate, total_pay

### `/api/scheduling/migrate` (POST) — ONE-TIME
- Reads Google Sheet data via service account
- Inserts into scheduling_employees + scheduling_entries
- Protected: admin only

## Frontend Pages

### `/scheduling` — Main Schedule Page
**Layout:** Full-width calendar grid view

**Header:**
- Page title: "Employee Scheduling" / "Programación de Empleados"
- Current date/time display (America/Indiana/Indianapolis timezone, updates every minute)
- Shift toggle: "Shift 1 (Day)" / "Shift 2 (Night)" tabs
- Search bar: search by employee name or employee ID (instant filter)
- Week navigation: ← Previous Week | Current Week | Next Week →

**Calendar Grid (main content):**
- Rows = employees (sorted alphabetically by last name)
- Columns = days of the week (Mon–Sun)
- Each cell shows:
  - Check/filled = scheduled that day
  - Time range (if custom, show it; if default, show shift label)
  - Machine/task assignment (small badge/tag)
  - Color coding: Day shift = blue, Night shift = purple

**For Group Leaders (edit mode):**
- Click a cell → popover/modal:
  - Toggle scheduled on/off
  - Select shift (1 or 2) with default times pre-filled
  - Override start/end time (time pickers)
  - Assign machine from dropdown (searchable, with "Add new machine" option)
  - Apply to: "This day only" / "This day onward (recurring)" / "Entire week"
- Drag to select multiple cells for bulk assignment
- Quick actions: "Copy last week's schedule", "Clear week"

**For Regular Employees (view mode):**
- Same grid but read-only
- Forward-looking only: today + future weeks (past dates hidden)
- No pay rate info visible
- Search still works — type name or ID to find schedule
- Mobile-friendly: card layout on small screens

**For Admins/Managers (full mode):**
- Everything group leaders can do PLUS:
- Can view past schedule history (navigate to previous weeks)
- "Hours & Pay" tab (see below)

### `/scheduling` — Hours & Pay Tab (Admin/Manager only)
- Tabbed view: "Schedule" | "Hours & Pay"
- Table: Employee | Hours This Week | OT Hours | Pay Rate | Gross Pay
- Date range picker for custom period
- Export to CSV/Excel
- Color coding: OT hours highlighted in amber

### Machine Management (within scheduling page)
- Expandable section or modal: "Manage Machines & Tasks"
- Table: Machine Name | Department | Active | Actions (Edit/Delete)
- Add new machine: name + department
- Machines appear as dropdown options when assigning shifts

## i18n Keys (add to en.json and es.json)

### en.json additions:
```json
{
  "scheduling.title": "Employee Scheduling",
  "scheduling.search": "Search by name or ID...",
  "scheduling.shift1": "Shift 1 (Day)",
  "scheduling.shift2": "Shift 2 (Night)",
  "scheduling.dayShift": "Day Shift",
  "scheduling.nightShift": "Night Shift",
  "scheduling.currentTime": "Current Time",
  "scheduling.today": "Today",
  "scheduling.thisWeek": "This Week",
  "scheduling.prevWeek": "Previous Week",
  "scheduling.nextWeek": "Next Week",
  "scheduling.assignShift": "Assign Shift",
  "scheduling.removeShift": "Remove Shift",
  "scheduling.customTime": "Custom Time",
  "scheduling.startTime": "Start Time",
  "scheduling.endTime": "End Time",
  "scheduling.machine": "Machine/Task",
  "scheduling.selectMachine": "Select machine...",
  "scheduling.addMachine": "Add New Machine",
  "scheduling.manageMachines": "Manage Machines & Tasks",
  "scheduling.machineName": "Machine Name",
  "scheduling.applyTo": "Apply to",
  "scheduling.thisDayOnly": "This day only",
  "scheduling.thisDayOnward": "This day onward",
  "scheduling.entireWeek": "Entire week",
  "scheduling.copyLastWeek": "Copy Last Week",
  "scheduling.clearWeek": "Clear Week",
  "scheduling.hoursPay": "Hours & Pay",
  "scheduling.totalHours": "Total Hours",
  "scheduling.regularHours": "Regular Hours",
  "scheduling.overtimeHours": "OT Hours",
  "scheduling.payRate": "Pay Rate",
  "scheduling.grossPay": "Gross Pay",
  "scheduling.noSchedule": "No schedule assigned",
  "scheduling.scheduled": "Scheduled",
  "scheduling.notScheduled": "Not Scheduled",
  "scheduling.employee": "Employee",
  "scheduling.department": "Department",
  "scheduling.exportCsv": "Export CSV",
  "scheduling.exportExcel": "Export Excel",
  "nav.scheduling": "Scheduling"
}
```

### es.json additions:
```json
{
  "scheduling.title": "Programación de Empleados",
  "scheduling.search": "Buscar por nombre o ID...",
  "scheduling.shift1": "Turno 1 (Día)",
  "scheduling.shift2": "Turno 2 (Noche)",
  "scheduling.dayShift": "Turno de Día",
  "scheduling.nightShift": "Turno de Noche",
  "scheduling.currentTime": "Hora Actual",
  "scheduling.today": "Hoy",
  "scheduling.thisWeek": "Esta Semana",
  "scheduling.prevWeek": "Semana Anterior",
  "scheduling.nextWeek": "Próxima Semana",
  "scheduling.assignShift": "Asignar Turno",
  "scheduling.removeShift": "Quitar Turno",
  "scheduling.customTime": "Hora Personalizada",
  "scheduling.startTime": "Hora de Inicio",
  "scheduling.endTime": "Hora de Fin",
  "scheduling.machine": "Máquina/Tarea",
  "scheduling.selectMachine": "Seleccionar máquina...",
  "scheduling.addMachine": "Agregar Nueva Máquina",
  "scheduling.manageMachines": "Administrar Máquinas y Tareas",
  "scheduling.machineName": "Nombre de Máquina",
  "scheduling.applyTo": "Aplicar a",
  "scheduling.thisDayOnly": "Solo este día",
  "scheduling.thisDayOnward": "De este día en adelante",
  "scheduling.entireWeek": "Toda la semana",
  "scheduling.copyLastWeek": "Copiar Semana Anterior",
  "scheduling.clearWeek": "Limpiar Semana",
  "scheduling.hoursPay": "Horas y Pago",
  "scheduling.totalHours": "Total de Horas",
  "scheduling.regularHours": "Horas Regulares",
  "scheduling.overtimeHours": "Horas Extra",
  "scheduling.payRate": "Tarifa por Hora",
  "scheduling.grossPay": "Pago Bruto",
  "scheduling.noSchedule": "Sin horario asignado",
  "scheduling.scheduled": "Programado",
  "scheduling.notScheduled": "No Programado",
  "scheduling.employee": "Empleado",
  "scheduling.department": "Departamento",
  "scheduling.exportCsv": "Exportar CSV",
  "scheduling.exportExcel": "Exportar Excel",
  "nav.scheduling": "Programación"
}
```

## Sidebar Integration
Add to `components/layout/Sidebar.tsx`:
- New nav item under PRODUCTION section: `{ tKey: "nav.scheduling", href: "/scheduling", icon: <CalendarDays className="size-4" /> }`
- Position: after "Shipping Records" entry

## File Structure
```
app/(dashboard)/scheduling/
  page.tsx                    — Main scheduling page
app/api/scheduling/
  employees/route.ts          — Employees CRUD
  entries/route.ts            — Schedule entries CRUD
  machines/route.ts           — Machines CRUD
  hours/route.ts              — Hours & pay (admin only)
  migrate/route.ts            — One-time migration
components/scheduling/
  ScheduleGrid.tsx            — Calendar grid component
  ShiftAssignModal.tsx        — Assign/edit shift popover
  MachineManager.tsx          — Machine CRUD modal
  HoursPayTable.tsx           — Hours & pay table (admin)
  ScheduleSearch.tsx           — Search bar component
  CurrentTime.tsx             — Live clock display
hooks/
  useScheduling.ts            — Data fetching hooks
supabase/migrations/
  20260227_scheduling.sql     — Migration file
```

## Existing Patterns to Follow
- Auth: `supabaseAdmin` from `@/lib/supabase-admin` for API routes
- i18n: `useTranslation()` hook from existing setup
- UI: shadcn/ui components (Button, Dialog, Popover, Select, Input, Table)
- Styling: Tailwind CSS, dark theme (bg-zinc-900/950 palette)
- Role check: read `user_profiles.role` for access control
- API pattern: see `app/api/customers/route.ts` for reference

## Machines to Seed (from Google Sheet "Planing" tab)
```
Eco border south, Eco border North, H1 three ring, H2 Curbs, H3,
Material handler, HA, Snap pad shuttle press, Plastic injection presses,
RT Blue line, RT Green Line, Hubing presses, Rotating hubbing press,
308/261 hubing line, Limpieza boom lift, Limpieza general 1,
Limpieza general 2, clavos, Packaging, Press 28, extruder
```

## Employee Data to Migrate
~70 employees from "Employee Reference data" tab. Fields:
employee_id, first_name, last_name, pay_rate, department, shift, shift_length, active

## Historical Schedule Data
~17,000 rows in "Long Data" tab (Sept 2025 → present). Fields:
employee_id, first_name, last_name, department, shift, date, checked, active, hours

## Access Rules Summary
| Role | View Past | Edit Schedule | See Pay Rates | Manage Machines |
|------|-----------|---------------|---------------|-----------------|
| Admin | ✅ | ✅ | ✅ | ✅ |
| Manager | ✅ | ✅ | ✅ | ✅ |
| Group Leader | ✅ | ✅ | ❌ | ✅ |
| Regular User | ❌ (forward only) | ❌ | ❌ | ❌ |
