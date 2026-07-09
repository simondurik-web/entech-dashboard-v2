-- Truckloads: lock multiple SOs/releases into one physical truck (Simon
-- 2026-07-08, after a multi-SO load shipped incomplete because the plan only
-- lived in screenshots). A truckload is created from the Pallet Load
-- Calculator (its full state is snapshotted for reload + the printable load
-- sheet), shows a "ships together" banner on every member order in Ready to
-- Ship, and drives the chained ship flow (one signature -> all BOLs).
--
-- ship_sessions: server-side scan progress for the Ship Order flow — written
-- after every scan so a page refresh / dead battery / Wi-Fi drop resumes
-- where the crew left off, from any device. Used by BOTH single-order and
-- truckload shipping.
--
-- RLS enabled with NO policies (default-deny for anon/authenticated); all
-- access goes through the API routes with the service-role client — same
-- pattern as user_table_prefs / print_jobs.

CREATE SEQUENCE IF NOT EXISTS truckload_number_seq;

CREATE TABLE IF NOT EXISTS public.truckloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_number text NOT NULL UNIQUE
    DEFAULT ('TL-' || lpad(nextval('truckload_number_seq')::text, 4, '0')),
  -- planned -> loading (first scan) -> shipped; canceled at any pre-shipped point
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'loading', 'shipped', 'canceled')),
  notes text,
  -- Full PalletLoadCalculator snapshot: { trailerKey, maxPayload, palletTypes,
  -- svgMarkup } — svgMarkup is the rendered trailer diagram captured at save
  -- time so the load sheet prints without re-mounting the calculator.
  calculator_state jsonb,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  shipped_at timestamptz,
  canceled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.truckload_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truckload_id uuid NOT NULL REFERENCES public.truckloads(id) ON DELETE CASCADE,
  -- ERPNext SO name ("SO-00020"); the ship flow keys on this
  so_number text NOT NULL,
  -- calculator identity: `${ifNumber}||${partNumber}` — matches PalletType.linkedOrderKeys
  order_key text NOT NULL,
  if_number text,
  customer text,
  part_number text,
  position int NOT NULL DEFAULT 0,
  -- pending -> shipped (DN submitted via the chained flow); released = manager
  -- override pulled it out of the truckload (ships individually)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shipped', 'released')),
  dn_number text,
  released_by text,
  released_at timestamptz,
  UNIQUE (truckload_id, order_key)
);

CREATE INDEX IF NOT EXISTS truckload_orders_so ON public.truckload_orders(so_number);
CREATE INDEX IF NOT EXISTS truckload_orders_tl ON public.truckload_orders(truckload_id);

CREATE TABLE IF NOT EXISTS public.ship_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for a plain single-order shipment
  truckload_id uuid REFERENCES public.truckloads(id) ON DELETE SET NULL,
  -- single-order mode: the SO being shipped; truckload mode: the current SO
  so_number text NOT NULL,
  -- { "<SO>": { "ok": ["PALLET1", ...], "mismatches": [{"palletId": "...", "reason": "..."}] } }
  scanned jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ "so": "SO-00020", "dn": "MAT-DN-2026-00071" }] in completion order
  completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  driver_name text,
  signature text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live session per order / per truckload. A second device that starts the
-- same shipment ADOPTS the active session (upsert in the API) instead of
-- forking a parallel one.
CREATE UNIQUE INDEX IF NOT EXISTS ship_sessions_active_so
  ON public.ship_sessions(so_number) WHERE status = 'active' AND truckload_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ship_sessions_active_tl
  ON public.ship_sessions(truckload_id) WHERE status = 'active' AND truckload_id IS NOT NULL;

ALTER TABLE public.truckloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.truckload_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ship_sessions ENABLE ROW LEVEL SECURITY;

-- Who may create/edit/cancel truckloads (decision 2, Simon 2026-07-08:
-- "Admin + Sales + Shipping Manager" — there is no sales role; manager covers
-- sales). Admin/super_admin bypass role_permissions entirely. shipping_team
-- ships truckloads (ship_loads) but cannot change them.
UPDATE public.role_permissions
SET menu_access = menu_access || '{"manage_truckloads": true}'::jsonb
WHERE role IN ('manager', 'shipping_manager');
