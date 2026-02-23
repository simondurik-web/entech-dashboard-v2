-- Notification rules: which events trigger notifications to which users
CREATE TABLE IF NOT EXISTS notification_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,  -- 'order_urgent', 'order_staged'
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_type, user_id)
);

-- Order state snapshots: tracks last-known state for change detection
CREATE TABLE IF NOT EXISTS order_state_snapshot (
  line_number TEXT PRIMARY KEY,
  urgent_override BOOLEAN DEFAULT false,
  status TEXT,
  customer TEXT,
  part_number TEXT,
  if_number TEXT,
  category TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_notification_rules_event ON notification_rules(event_type);
CREATE INDEX IF NOT EXISTS idx_order_state_status ON order_state_snapshot(status);

-- RLS policies
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_state_snapshot ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (API routes use service key)
CREATE POLICY "Service role full access on notification_rules" ON notification_rules
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on order_state_snapshot" ON order_state_snapshot
  FOR ALL USING (true) WITH CHECK (true);
