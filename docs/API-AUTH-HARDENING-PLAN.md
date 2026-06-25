# API Auth Hardening — Plan & Handoff

**Owner: claude-3 (#molding-dashboard).** Handed off by claude-2 (#erp) on 2026-06-25.
Surfaced by the 4-agent security review of the app-scoped lockdown + blacklist
(commit `10a6563`, already in production).

## The problem (in priority order)

The dashboard's API layer decides **who you are** from a value the browser sends,
not from the verified login token. So the role checks (including the new `blocked`
blacklist) are only as trustworthy as that header.

1. **`x-user-id` trust (highest impact).** ~**22 of 139** API route files read identity
   from the `x-user-id` request header instead of the Supabase Bearer JWT. Anyone who
   knows an enrolled/admin user's UUID can spoof it and act as them, bypassing all role
   gating. Regenerate the list anytime with:
   ```
   git grep -lE "x-user-id" origin/main -- 'app/api/**/route.ts'
   ```
   Current 22: `admin/{devices,permissions,users}`, `chat/phil`,
   `labels/{route,[id],activity,settings}`, `notifications/log`, `orders/priority`,
   `po-automation/{route,[id],documents,toter-portal}`,
   `purchasing/{route,[id],options,photos,[id]/photos}`, `rolltech-actions/mutate`,
   `views/{route,[id]}`.
2. **Unauthenticated routes.** Some routes have NO auth gate at all — e.g.
   `app/api/sheets`, `app/api/all-data`, `app/api/bom/individual-items`,
   unauthenticated scheduling GET, `app/api/notifications/send`. The visitor menu
   lockdown does not stop direct API calls to these.
3. **Loose RLS.** Some Postgres RLS policies (`20260227_scheduling.sql`,
   `20260323_labels_system.sql`, `001_auth_rbac.sql`) broadly grant any authenticated
   user, independent of `user_app_roles(app_id='dashboard')`.

## The correct pattern already exists

`app/api/auth/profile/route.ts` → `getUserFromRequest(req)`:
```ts
async function getUserFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice(7)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  return user            // user.id is the TRUSTED uuid; user.email the trusted email
}
```
Only 4 routes use the verified-token pattern today: `auth/profile`,
`cron/check-order-changes`, `pallet-records/users`, `price-lookup`.

## Plan (3 phases — each on a branch → staging → main, 4-agent reviewed before prod)

**Phase 1 (do first — closes the spoofing hole):**
- Add a shared helper, e.g. `lib/require-user.ts` `requireUser(req): Promise<{id, email} | null>`
  (the `getUserFromRequest` body above, centralized).
- Swap each of the 22 `x-user-id` routes to derive `userId` from `requireUser(req)`
  instead of `req.headers.get('x-user-id')`. The existing role guards
  (`lib/erpnext/auth.ts`, `lib/purchasing/guard.ts`, `lib/po-automation/guard.ts`,
  `lib/quality/guard.ts`, `lib/pallets/guard.ts`, `app/api/scheduling/_utils.ts`) take a
  `userId` — keep them, just feed the *verified* id.
- **Client side (critical):** audit the browser `fetch` calls to those routes — many send
  only `x-user-id` today. They must send `Authorization: Bearer <session.access_token>`.
  The token is on the Supabase session (`supabase.auth.getSession()`); `lib/auth-context.tsx`
  already has it. **Do server + client together per route and test on staging**, or the
  route 401s until the client is updated.

**Phase 2:** audit all 139 routes; add auth to the ungated ones (#2 above).

**Phase 3:** RLS audit (#3) — tighten policies; gate writes on `user_app_roles(dashboard)`
where appropriate. NOTE: `user_profiles.role` was reconciled to equal the dashboard
app-role on 2026-06-25, and the admin Users API now keeps them in sync, so policies that
read `user_profiles.role` are at least consistent — but direct-grant-to-authenticated
policies still need tightening.

## Parallel-work guardrails (so claude-2 and claude-3 don't collide)

- **claude-2 (#erp):** stays on the ERPNext side (`erp-4molding`, ERP desk, BOL formats,
  print stations, Cloudflare/Supabase infra) — a different repo, no file overlap.
- **claude-3 (#molding-dashboard):** owns this hardening + dashboard-repo features.
- **Watch-zone:** the dashboard label module + print relay live in THIS repo, and the
  label API routes (`app/api/labels/*`) are on the Phase-1 list. If a dashboard label
  feature and the hardening touch the same file, sequence them and log it in CONTEXT.md.
- Use a dedicated branch (`security/api-auth-hardening`), the `staging` → `main` flow, and
  the 4-agent review (Codex `--skip-git-repo-check` + `</dev/null`; `handoff gemini` /
  `agy` not bare gemini; `grok --effort high`; + Opus). Hand Simon the stable
  `…git-staging-…vercel.app` URL, not throwaway preview links.
