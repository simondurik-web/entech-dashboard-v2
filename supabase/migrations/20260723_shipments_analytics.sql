CREATE INDEX IF NOT EXISTS shipment_history_sent_at_idx ON public.shipment_history (sent_at);
CREATE INDEX IF NOT EXISTS shipment_history_part_idx ON public.shipment_history (part_number);
CREATE INDEX IF NOT EXISTS shipment_history_source_idx ON public.shipment_history (source_system);

-- Range predicates compare raw sent_at against ET-midnight bounds (sargable —
-- wrapping sent_at in AT TIME ZONE would defeat the btree index above).
CREATE OR REPLACE FUNCTION public.shipment_daily_rollup(p_from date, p_to date)
RETURNS TABLE(day date, source_system text, part_number text, service text,
              units bigint, lines bigint, orders bigint)
LANGUAGE sql STABLE AS $$
  SELECT (sent_at AT TIME ZONE 'America/New_York')::date AS day,
         source_system, part_number, service,
         SUM(qty)::bigint, COUNT(*)::bigint, COUNT(DISTINCT po_number)::bigint
  FROM public.shipment_history
  WHERE sent_at >= (p_from::timestamp AT TIME ZONE 'America/New_York')
    AND sent_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/New_York')
  GROUP BY 1, 2, 3, 4
$$;
REVOKE EXECUTE ON FUNCTION public.shipment_daily_rollup(date, date) FROM PUBLIC, anon, authenticated;

-- Distinct-order counts must come from an ungrouped-by-part pass: summing the
-- per-part rollup's orders double-counts POs that span multiple parts/services.
CREATE OR REPLACE FUNCTION public.shipment_daily_orders(p_from date, p_to date)
RETURNS TABLE(day date, source_system text, orders bigint)
LANGUAGE sql STABLE AS $$
  SELECT (sent_at AT TIME ZONE 'America/New_York')::date AS day,
         source_system,
         COUNT(DISTINCT po_number)::bigint
  FROM public.shipment_history
  WHERE sent_at >= (p_from::timestamp AT TIME ZONE 'America/New_York')
    AND sent_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/New_York')
  GROUP BY 1, 2
$$;
REVOKE EXECUTE ON FUNCTION public.shipment_daily_orders(date, date) FROM PUBLIC, anon, authenticated;

-- PII-safe projection for the Phil Assistant (phil_reader is SQL-allowlisted
-- per domain; email/phone stay out of anything Phil can SELECT).
CREATE OR REPLACE VIEW public.shipment_history_safe AS
  SELECT id, run_id, sent_at, po_number, partner, ship_to_name, ship_to_address,
         city, state, zip, residential, service, source_system, tracking,
         part_number, qty
  FROM public.shipment_history;
GRANT SELECT ON public.shipment_history_safe TO phil_reader;
