-- Auth & RBAC Tables for Entech Dashboard
-- Run this in Supabase SQL Editor

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  role text NOT NULL DEFAULT 'regular_user',
  custom_permissions jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Role definitions with default menu permissions
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  role text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  menu_access jsonb NOT NULL DEFAULT '{}',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- user_profiles policies
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles" ON public.user_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update all profiles" ON public.user_profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert profiles" ON public.user_profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id OR
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Allow users to insert their own profile (for first login)
CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- role_permissions policies
CREATE POLICY "Anyone can read role_permissions" ON public.role_permissions
  FOR SELECT USING (true);

CREATE POLICY "Admins can update role_permissions" ON public.role_permissions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert role_permissions" ON public.role_permissions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Seed role_permissions
INSERT INTO public.role_permissions (role, label, description, menu_access, sort_order) VALUES
(
  'visitor',
  'Visitor',
  'Not logged in — limited view-only access',
  '{"/orders": true, "/inventory": true, "/shipped": true}',
  0
),
(
  'regular_user',
  'Regular User',
  'Production floor workers — all production items + sales overview',
  '{"/orders": true, "/need-to-make": true, "/need-to-package": true, "/staged": true, "/shipped": true, "/inventory": true, "/inventory-history": true, "/drawings": true, "/pallet-records": true, "/shipping-records": true, "/bom": true, "/material-requirements": true, "/fp-reference": true, "/customer-reference": true, "/quotes": true, "/sales-overview": true}',
  1
),
(
  'group_leader',
  'Group Leader',
  'Supervisory access — production + all sales',
  '{"/orders": true, "/need-to-make": true, "/need-to-package": true, "/staged": true, "/shipped": true, "/inventory": true, "/inventory-history": true, "/drawings": true, "/pallet-records": true, "/shipping-records": true, "/bom": true, "/material-requirements": true, "/fp-reference": true, "/customer-reference": true, "/quotes": true, "/sales-overview": true, "/sales-parts": true, "/sales-customers": true, "/sales-dates": true}',
  2
),
(
  'manager',
  'Manager',
  'Full access except admin — can have custom overrides',
  '{"/orders": true, "/need-to-make": true, "/need-to-package": true, "/staged": true, "/shipped": true, "/inventory": true, "/inventory-history": true, "/drawings": true, "/pallet-records": true, "/shipping-records": true, "/bom": true, "/material-requirements": true, "/fp-reference": true, "/customer-reference": true, "/quotes": true, "/sales-overview": true, "/sales-parts": true, "/sales-customers": true, "/sales-dates": true, "/all-data": true}',
  3
),
(
  'admin',
  'Admin',
  'Full access to everything including user management',
  '{"/orders": true, "/need-to-make": true, "/need-to-package": true, "/staged": true, "/shipped": true, "/inventory": true, "/inventory-history": true, "/drawings": true, "/pallet-records": true, "/shipping-records": true, "/bom": true, "/material-requirements": true, "/fp-reference": true, "/customer-reference": true, "/quotes": true, "/sales-overview": true, "/sales-parts": true, "/sales-customers": true, "/sales-dates": true, "/all-data": true, "/admin/users": true, "/admin/permissions": true}',
  4
)
ON CONFLICT (role) DO NOTHING;

-- Auto-create user_profile on new auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
