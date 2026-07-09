-- Load sheet pallet counts (Simon 2026-07-09): the sheet shows how many
-- pallets each member order contributes, so the crew can count the truck.
-- Captured at link time from the order's pallet records (fallback: the
-- estimated package count); backfilled for existing truckloads from
-- dashboard_orders.number_of_packages.
ALTER TABLE public.truckload_orders ADD COLUMN IF NOT EXISTS pallet_count int;
