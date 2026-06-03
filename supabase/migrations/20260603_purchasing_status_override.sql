-- Manual status override for purchasing orders. The order_status is normally
-- date-derived (Requested→Ordered→Received), but Vanessa can set it explicitly
-- from a dropdown (esp. Canceled/Refunded/Partial). status_override wins over
-- the date-derived status; NULL means "Auto" (follow the dates). This replaces
-- the old canceled/refunded/partial_delivery checkbox columns in the UI.
ALTER TABLE purchasing_orders ADD COLUMN IF NOT EXISTS status_override text;

-- Migrate existing checkbox flags into the override (precedence matches the old
-- derivation: refunded > canceled > partial).
UPDATE purchasing_orders SET status_override = 'Refunded' WHERE refunded = true AND status_override IS NULL;
UPDATE purchasing_orders SET status_override = 'Canceled' WHERE canceled = true AND refunded = false AND status_override IS NULL;
UPDATE purchasing_orders SET status_override = 'Partial'  WHERE partial_delivery = true AND canceled = false AND refunded = false AND status_override IS NULL;
