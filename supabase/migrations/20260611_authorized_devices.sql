-- Authorized devices — shared floor computers that access the dashboard via
-- an admin-approved device token instead of a personal Google login.
-- (Simon 2026-06-11: floor PC used by ~20 employees; device requests access,
-- admin approves and assigns a role he can edit on the fly.)
--
-- The raw token lives only in the device's localStorage; the server stores a
-- sha256 hash. Devices can never hold the admin role (enforced in the API).

CREATE TABLE IF NOT EXISTS public.authorized_devices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  pairing_code text NOT NULL,
  name text NOT NULL DEFAULT 'Unnamed device',
  role text NOT NULL DEFAULT 'regular_user',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
  user_agent text,
  requested_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Service-role access only — every read/write goes through the API routes.
ALTER TABLE public.authorized_devices ENABLE ROW LEVEL SECURITY;
