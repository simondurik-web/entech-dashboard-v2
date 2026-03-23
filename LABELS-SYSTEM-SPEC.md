# Labels System — Full Implementation Spec

**Branch:** `feature/labels-system`
**Tier:** 3 (DB migrations + permissions + new feature)
**Approach:** 6 sequential phases, each verified before next

---

## Phase 1: Database Migration + Storage
- Create `labels` table in Supabase
- Create `label_settings` table for config (replaces Labels setup sheet)
- Create `label_activity_log` table
- Add RLS policies
- Create Supabase Storage bucket for label PDFs

## Phase 2: Permissions + Sidebar
- Add `/labels`, `labels:generate`, `labels:print`, `labels:settings` to permissions system
- Add Labels nav item to Sidebar (under PRODUCTION section)
- Create the labels page shell

## Phase 3: Label Generation Engine
- API route: `/api/labels/generate` — generates label data + PDF
- Label template component (React) matching the existing Pallet Label layout
- QR code generation
- PDF generation (browser-side with @react-pdf/renderer or server-side)
- Store generated labels in Supabase

## Phase 4: Labels Management Page
- Labels dashboard showing all labels (pending, generated, printed)
- Generate new labels (select orders → generate)
- Label preview modal with print functionality
- Activity log view
- Settings panel (email recipients, auto-gen toggle)

## Phase 5: Need-to-Package Integration
- Add "Print Label" button/icon on each row in Need to Package
- Click → modal with label preview + print
- Customer Reference validation (alert if parts_per_package missing)
- Assigned To dropdown (editable, pulls from app_users)

## Phase 6: Auto-Generation + Email
- API route or Edge Function for auto-generation
- Replaces the Google Sheets hourly trigger
- Email delivery via automated@4molding.com
- Error tracking + notifications

---

## Data Architecture

### `labels` table
```sql
CREATE TABLE labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_line TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  order_qty INTEGER NOT NULL,
  parts_per_package INTEGER NOT NULL,
  num_packages INTEGER NOT NULL,
  packaging_type TEXT,
  qr_data TEXT,
  label_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (label_status IN ('pending', 'generated', 'emailed', 'printed')),
  pdf_storage_path TEXT,
  assigned_to TEXT,
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ DEFAULT now(),
  emailed_to TEXT[],
  emailed_at TIMESTAMPTZ,
  printed_by UUID REFERENCES auth.users(id),
  printed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### `label_settings` table
```sql
CREATE TABLE label_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Rows: email_recipients, auto_enabled, last_processed_line
```

### `label_activity_log` table
```sql
CREATE TABLE label_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label_id UUID REFERENCES labels(id),
  order_line TEXT,
  action TEXT NOT NULL, -- 'generated', 'emailed', 'printed', 'error'
  status TEXT NOT NULL, -- 'success', 'error', 'skipped'
  recipients TEXT,
  pdf_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```
