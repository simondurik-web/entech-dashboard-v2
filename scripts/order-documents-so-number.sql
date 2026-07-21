-- Per-SO BOL scoping (2026-07-21): a multi-SO PO (e.g. Amazon FBA, one BOL per
-- destination) needs each BOL filed against its own sales order, not the PO.
-- Applied to the shared Supabase project on 2026-07-21 via the management API.
alter table po_automation.order_documents
  add column if not exists so_number text;
comment on column po_automation.order_documents.so_number is
  'ERPNext Sales Order this doc is scoped to; null = order-level (whole PO). Added 2026-07-21 per-SO BOL scoping.';
