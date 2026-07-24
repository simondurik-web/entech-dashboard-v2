-- E-commerce 4x6 label dispatch to driver-based Zebra queues (agent v3).
-- target='zebra' pdf jobs print via lp -o PageSize=w288h432 to the station's
-- Zebra CUPS queue; zebra_pdf marks stations whose agent supports it — only
-- flag a station AFTER its agent is upgraded (older agents route every pdf
-- job to the letter printer).
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE public.print_stations ADD COLUMN IF NOT EXISTS zebra_pdf boolean NOT NULL DEFAULT false;

-- MCP connector (AI) read access to e-commerce shipments — the PII-safe view
-- only; shipment_history itself (email/phone) stays invisible to the role.
GRANT SELECT ON public.shipment_history_safe TO mcp_query_reader;
