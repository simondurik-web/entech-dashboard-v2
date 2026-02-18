# Google OAuth Setup for Entech Dashboard

## 1. Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select or create a project
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth client ID**
5. Application type: **Web application**
6. Name: `Entech Dashboard`
7. Authorized redirect URIs: `https://mqfjmzqeccufqhisqpij.supabase.co/auth/v1/callback`
8. Click **Create** — save the **Client ID** and **Client Secret**

## 2. Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/mqfjmzqeccufqhisqpij)
2. Navigate to **Authentication → Providers → Google**
3. Enable Google provider
4. Paste the **Client ID** and **Client Secret** from step 1
5. Save

## 3. Run Database Migration

Go to **SQL Editor** in Supabase Dashboard and run the contents of:
`supabase/migrations/001_auth_rbac.sql`

## 4. Set First Admin

After your first Google login, promote yourself to admin:

```sql
UPDATE public.user_profiles SET role = 'admin' WHERE email = 'your-email@4entech.com';
```
