-- Purchasing feature: full export of the "Purchasing Sheet" (all data Combined tab)
-- Stores RAW input fields only. Order Status, Cost per unit, Days-until-delivery are
-- derived in the app (lib/purchasing/compute.ts) so they stay live on add/edit,
-- mirroring the Google Sheet formulas.

CREATE TABLE IF NOT EXISTS purchasing_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  legacy_row integer,                 -- original sheet row number (traceability)
  item_description text,
  external_number text,
  quantity numeric,
  total_cost numeric,
  delivery_cost numeric,
  canceled boolean NOT NULL DEFAULT false,
  refunded boolean NOT NULL DEFAULT false,
  urgent boolean NOT NULL DEFAULT false,
  partial_delivery boolean NOT NULL DEFAULT false,
  requestor text,
  deliver_to text,
  sub_department text,
  department text,
  store text,
  supplier_link text,
  date_requested date,
  date_ordered date,
  promised_date date,
  received_date date,
  received_by text,
  poe_cc text,
  notes text,
  packing_slip_pic text,
  item_pic text,
  deleted_at timestamptz,             -- soft delete (recoverable; visible in audit)
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchasing_orders_department ON purchasing_orders(department);
CREATE INDEX IF NOT EXISTS idx_purchasing_orders_deleted ON purchasing_orders(deleted_at);
CREATE INDEX IF NOT EXISTS idx_purchasing_orders_date_requested ON purchasing_orders(date_requested DESC);

ALTER TABLE purchasing_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchasing_orders_service_full') THEN
    CREATE POLICY purchasing_orders_service_full ON purchasing_orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Audit trail (mirrors bom_audit). item_description snapshotted so deleted rows stay readable.
CREATE TABLE IF NOT EXISTS purchasing_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  item_description text,
  action text NOT NULL,               -- 'created' | 'updated' | 'deleted' | 'restored'
  field_name text,
  old_value text,
  new_value text,
  performed_by_name text,
  performed_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchasing_audit_order ON purchasing_audit(order_id);
CREATE INDEX IF NOT EXISTS idx_purchasing_audit_created ON purchasing_audit(created_at DESC);

ALTER TABLE purchasing_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'purchasing_audit_service_full') THEN
    CREATE POLICY purchasing_audit_service_full ON purchasing_audit FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
