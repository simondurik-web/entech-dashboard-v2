# API Auth Hardening — COMPLETE (close-out)

**Owner:** claude-3 (#molding-dashboard). **Finished:** 2026-06-26. **Status:** all phases shipped to production and verified.

This is the definitive wrap-up of the security project scoped in `docs/API-AUTH-HARDENING-PLAN.md`. Everything below is live on `main` (prod = entech-dashboard-v2.vercel.app).

## What was wrong (before)
1. ~22 API routes trusted a spoofable `x-user-id` header for identity.
2. ~33 write handlers + many read handlers had **no auth at all** (anonymous read/write via the API).
3. **CRITICAL:** Postgres RLS — `anon`/`authenticated` roles had full read+write grants on ~48 public tables with `ALL:{public}:true` policies. The `anon` key ships in the browser bundle, so **anyone could read/insert/update/DELETE the entire business + financial DB directly**, bypassing the API entirely.

## What shipped (all in prod)
| Phase | Change |
|---|---|
| **1** | 22 `x-user-id` routes → verified Supabase Bearer JWT. Service-key (`x-service-key`) path for trusted PO scripts on `po-automation/documents`. |
| **Labels** | label write routes → user OR approved floor device. |
| **2a** | every unauthenticated **write** route gated (BOM, customers, customer-part-mappings, quotes, orders/assign, notifications, pallet-records); admin/permission checks on sensitive ones; scheduling migrated off `x-user-id`. |
| **2b** | every shared **read** route gated; global client fetch interceptor; CDN caching removed from gated routes. |
| **3 (RLS)** | revoked all `anon`+`authenticated` writes and reads, except 8 browser-read tables. |
| Cron | `cron/check-order-changes` already used `CRON_SECRET` (no change needed). |

## Key files (where the logic lives)
- **`lib/require-user.ts`** — server gate helpers: `requireUser`, `requireUserOrDevice`, `requireUserOrService`, `requireReadAccess`, `requireDashboardAccess`, `requireAdmin`, `requirePermission`.
- **`lib/session-token.ts`** — client `authHeaders()` + module token cache (primed sync from localStorage).
- **`lib/api-fetch-interceptor.ts`** — patches `window.fetch` to attach Bearer + `x-device-token` to same-origin `/api/` calls; installed at `lib/auth-context.tsx` module load.
- **`supabase/migrations/20260626_rls_lockdown_anon_authenticated.sql`** — the RLS lockdown (already applied to prod via the Supabase mgmt API; file is the tracked record).

## RLS details (Phase 3)
- `anon` + `authenticated`: **0 write** grants, **SELECT only on 8 tables**: `role_permissions`, `priority_overrides`, `bom_final_assemblies`, `qa_products`, `qa_hub_inspections`, `qa_tire_inspections`, `qa_finished_inspections`, `qa_audit_trail` (the only tables the browser reads directly via the anon supabase client).
- `service_role` (the API) and the `postgres` superuser (the 5-min Sheets→Supabase sync, psycopg2) **bypass RLS** → unaffected.
- **GOTCHA:** shared-floor devices have NO Supabase login → they are the Postgres `anon` role. That's why anon keeps SELECT on the 8 device-read tables. Never blanket-block `anon` without preserving those.
- The old permissive `ALL:{public}:true` policies still exist but are now moot (no grant ⇒ no access). Optional cleanup: `DROP` them.

## Cross-repo / infra changes
- **po-automation repo** (`entech-po-automation`, pushed): `orchestrator/quote_engine.py` (`_headers`, shared by all `_q_*.py`), `toter-portal/release_toter.py`, `orchestrator/attach_po_pdf.py` now send `x-service-key` on dashboard calls.
- **Vercel env:** `PO_AUTOMATION_API_KEY` set on production + preview.
- **Secret:** `~/clawd/secrets/po-automation-service.env` (`PO_AUTOMATION_API_KEY=...`) — same value as Vercel; read by the PO scripts. Long-lived Vercel token saved at `~/clawd/secrets/vercel-token.json`.

## How to verify (anytime)
```
# anonymous reads/writes are blocked (prod):
curl -s -o /dev/null -w "%{http_code}\n" https://entech-dashboard-v2.vercel.app/api/sheets   # 401
# DB level (mgmt API, SET ROLE anon): SELECT on dashboard_orders => permission denied; on role_permissions => ok
```

## Reversibility
The RLS change is one statement to undo per table: `GRANT SELECT ON public.<table> TO authenticated;` (or `anon`). If a logged-in page ever shows missing data, re-grant that table and investigate which client read needs it.

## Follow-ups (non-urgent)
- DROP the now-moot permissive RLS policies for cleanliness.
- Consider role-scoped RLS (vs just `authenticated`) if direct client reads ever expand.
- Process note: the `handoff codex` reviewer was contaminated by stale files in `/tmp` — run it from a clean dir containing only the diff; gemini/grok timed out on >1k-line diffs.

Memory: `project_entech_dashboard_api_auth_hardening`. Coordination log: `CONTEXT.md` "✅ COMPLETE — API Auth Hardening".
