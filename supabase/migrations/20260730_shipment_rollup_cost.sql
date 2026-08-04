-- Surface shipping_cost_usd through the analytics RPCs.
--
-- Both functions are DROPped first: Postgres cannot add columns to an existing
-- function's RETURNS TABLE via CREATE OR REPLACE ("cannot change return type of
-- existing function"). DROP+CREATE resets privileges to the default (EXECUTE to
-- PUBLIC), so the REVOKEs below are NOT optional — without them these functions
-- become callable by anon/authenticated. The app calls them with the service
-- role (lib/shipments/rpc.ts → supabaseAdmin), which is unaffected by the REVOKE.
--
-- Cost grain: shipping_cost_usd is written on exactly ONE shipment_history row
-- per (run_id, po_number). SUM therefore carries each shipment's cost exactly
-- once, at any grouping.
--
-- priced_orders is deliberately COUNT(DISTINCT po_number) FILTER (...), the SAME
-- grain as `orders` in the same row — a count of priced ROWS could exceed the
-- distinct-PO denominator when one PO ships twice in a day (two runs), which
-- would render as an impossible "2 of 1 priced". Numerator and denominator must
-- share a grain.

-- Wrapped in a transaction: DDL is transactional in Postgres, so analytics
-- never observes a dropped function or a re-created one that still has the
-- default PUBLIC EXECUTE grant.
BEGIN;

DROP FUNCTION IF EXISTS public.shipment_daily_rollup(date, date);
CREATE FUNCTION public.shipment_daily_rollup(p_from date, p_to date)
RETURNS TABLE(day date, source_system text, part_number text, service text,
              units bigint, lines bigint, orders bigint,
              shipping_cost_usd numeric, priced_orders bigint)
LANGUAGE sql STABLE AS $$
  SELECT (sent_at AT TIME ZONE 'America/New_York')::date AS day,
         source_system, part_number, service,
         SUM(qty)::bigint, COUNT(*)::bigint, COUNT(DISTINCT po_number)::bigint,
         SUM(shipping_cost_usd),
         COUNT(DISTINCT po_number) FILTER (WHERE shipping_cost_usd IS NOT NULL)
  FROM public.shipment_history
  WHERE sent_at >= (p_from::timestamp AT TIME ZONE 'America/New_York')
    AND sent_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/New_York')
  GROUP BY 1, 2, 3, 4
$$;
REVOKE EXECUTE ON FUNCTION public.shipment_daily_rollup(date, date) FROM PUBLIC, anon, authenticated;

-- Distinct-order counts must come from an ungrouped-by-part pass: summing the
-- per-part rollup's orders double-counts POs that span multiple parts/services.
-- priced_orders rides the same pass for the same reason — a PO whose priced row
-- sits in one part group and whose other lines sit in another must count once.
DROP FUNCTION IF EXISTS public.shipment_daily_orders(date, date);
CREATE FUNCTION public.shipment_daily_orders(p_from date, p_to date)
RETURNS TABLE(day date, source_system text, orders bigint, priced_orders bigint)
LANGUAGE sql STABLE AS $$
  SELECT (sent_at AT TIME ZONE 'America/New_York')::date AS day,
         source_system,
         COUNT(DISTINCT po_number)::bigint,
         COUNT(DISTINCT po_number) FILTER (WHERE shipping_cost_usd IS NOT NULL)
  FROM public.shipment_history
  WHERE sent_at >= (p_from::timestamp AT TIME ZONE 'America/New_York')
    AND sent_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/New_York')
  GROUP BY 1, 2
$$;
REVOKE EXECUTE ON FUNCTION public.shipment_daily_orders(date, date) FROM PUBLIC, anon, authenticated;

COMMIT;
