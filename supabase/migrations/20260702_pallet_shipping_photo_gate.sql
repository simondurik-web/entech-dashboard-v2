-- Pallet Records: Production -> Shipping photo gate override.
--
-- Since the Fusion->ERPNext migration, an order's sheet status flips to
-- "Staged" automatically when shipping labels are created. The dashboard now
-- holds a Staged order in the Pallet Records "Production" list until every
-- expected pallet has a valid photo (see lib/pallets/staging-gate.ts). This
-- table records the admin-only "Force to Shipping" override that moves a
-- still-unphotographed order to Shipping anyway.
--
-- Keyed by line_number (the per-order handle used throughout the pallet
-- flow). Accessed only via supabaseAdmin (service role, bypasses RLS); RLS is
-- enabled with no policies so anon/authenticated get nothing.
create table if not exists public.pallet_shipping_overrides (
  line_number    text primary key,
  forced_by      uuid,
  forced_by_name text,
  forced_at      timestamptz not null default now()
);

alter table public.pallet_shipping_overrides enable row level security;

revoke all on public.pallet_shipping_overrides from anon, authenticated;
grant all on public.pallet_shipping_overrides to service_role;

comment on table public.pallet_shipping_overrides is
  'Admin "Force to Shipping" overrides for the pallet-photo gate. A row here forces its line_number to Shipping even if not all pallets are photographed. Service-role only. Managed via Pallet Records > Production.';
