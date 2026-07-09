-- Line-scoped truckloads (Simon 2026-07-09, TL-0002/SO-00020 incident): a
-- truckload entry is ONE dashboard line (release), not the whole SO. The line
-- number drives banner matching, the load sheet, and the line-scoped ship flow
-- (scan + DN cover exactly that line's pallets).
ALTER TABLE public.truckload_orders ADD COLUMN IF NOT EXISTS line int;
