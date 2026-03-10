-- Per-app role system: each app gets independent roles per user
CREATE TABLE IF NOT EXISTS user_app_roles (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL CHECK (app_id IN ('dashboard', 'quality', 'production', 'snappad')),
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_user_app_roles_user ON user_app_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_app_roles_app ON user_app_roles(app_id);

-- RLS
ALTER TABLE user_app_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own roles
DO $$ BEGIN
CREATE POLICY "Users can read own app roles" ON user_app_roles
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role full access
DO $$ BEGIN
CREATE POLICY "Service role full access on app roles" ON user_app_roles
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed: copy current user_profiles.role to all 4 apps for each user
INSERT INTO user_app_roles (user_id, app_id, role)
SELECT id, 'dashboard', COALESCE(role, 'visitor') FROM user_profiles
ON CONFLICT (user_id, app_id) DO NOTHING;

INSERT INTO user_app_roles (user_id, app_id, role)
SELECT id, 'quality', COALESCE(role, 'visitor') FROM user_profiles
ON CONFLICT (user_id, app_id) DO NOTHING;

INSERT INTO user_app_roles (user_id, app_id, role)
SELECT id, 'production', COALESCE(role, 'visitor') FROM user_profiles
ON CONFLICT (user_id, app_id) DO NOTHING;

INSERT INTO user_app_roles (user_id, app_id, role)
SELECT id, 'snappad', COALESCE(role, 'visitor') FROM user_profiles
ON CONFLICT (user_id, app_id) DO NOTHING;
