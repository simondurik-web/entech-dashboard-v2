# Pallet Registration App → Molding Dashboard Integration Plan

> Started 2026-06-10. Simon's decisions: section named **Pallet Records** (option 1 — existing
> photo page renamed to **Pallet Photos**); reuse the production app's ES translations verbatim;
> access mirrors the app's existing users; verify desktop + iPad + iPhone; **staging only — NO
> redirect of entech-production-app.vercel.app until Simon tests and approves.**

## STATUS / CHECKPOINT
- Worktree `~/clawd/projects/pallet-records-integration`, branch `feat/pallet-records` off staging.
  node_modules symlinked to quality-integration's (real install, has googleapis/web-push).
- Recon DONE (agent report 2026-06-10): source = `~/clawd/projects/entech-production-app/entech-app`
  (nested repo, deployed from main @21e33a8; working tree == production). 41 files / 6.2k LOC.
- Phase A ✅ (b248885) + Phase B ✅ (a07a024, Codex; sandbox font/webpack hacks reverted) + 4-agent
  review fixes ✅ (ba43162: identity→auth-UUID matching live DB, audit/Sheets writes non-fatal,
  push rewired onto the dashboard real push_subscriptions schema, formula-injection sanitized,
  ownership=userId only, upload sanitization, users enum+super-admin immutable, theme fixes).
  role_permissions /pallet-photos copied for all 6 roles. PUSHED TO STAGING (ba43162).
- QR labels: dashboard lib/label-utils.ts now encodes
  https://entech-dashboard-v2.vercel.app/pallet-records/scan (1e21603) — labels printed during the
  staging window only resolve after cutover (told Simon). RT-Labels Apps Script (Sheet, ~line 1187)
  still old URL — repoint at cutover. Old printed labels covered by the redirect's query passthrough.
- NEXT: Simon tests staging desktop/iPad/iPhone → then (his go) cutover: redirect
  entech-production-app.vercel.app per-path incl /scan?query passthrough + repoint RT-Labels
  Apps Script QR_APP_URL + promote to main.

## Source app facts that drive the design
- Same Supabase project. Tables: `pallet_records`, `shipping_records`, `audit_trail`,
  `users` (shared with snappad via `app` column; app='production'; roles admin|user,
  status active|pending|disabled; super-admin simondurik@gmail.com hardcoded), `push_subscriptions`,
  storage bucket `pallet-photos` (public). NO RPCs.
- DUAL-WRITE GOOGLE SHEETS (CRITICAL — must keep): reads `Main Data!A:Z` (orders, col S = pallets
  required, col H = status); writes `App Pallet Records!A:Q`, `App Shipping Records!A:P`, and
  `Main Data!H{row}` status auto-revert on pallet delete. Consumers of those Sheet tabs: Main Data
  COUNTIFS, molding dashboard sync, /pallet-records photos page, SnapPad portal. Source sheets layer:
  `src/lib/google.ts` (committed service-account json fallback — DO NOT port that; reuse dashboard's
  lib/google-auth pattern with a write-scoped JWT like lib/google-sheets-write.ts).
- SECURITY GAP IN SOURCE: most APIs unauthenticated; admin trusted from client (`?is_admin=true`).
  Port replaces with server guard. i18n: `src/lib/i18n.ts` (~110 keys, ES default) — reuse verbatim.
- Mobile-first single-column pages (no tables); camera capture + canvas compression; two upload
  paths (signed-url direct for pallets, server-proxied for shipping); QR deep-link /scan →
  localStorage scan_context → auto-open pallet form; PWA + web push (VAPID env, push_subscriptions).
- Shipping draft lifecycle: pallet-photos-only draft (carrier NULL) → merge → carrier set →
  one-shot Sheet append on transition.

## Design
- Routes: `app/(dashboard)/pallet-records/` = Production screen (list|detail|pallet-form),
  `/pallet-records/shipping`, `/pallet-records/admin` (Users/Audit/Notify), `/pallet-records/scan`.
  APIs under `app/api/pallet-records/*` (orders, orders/start, pallets, pallets/counts,
  pallets/bulk-update, shipping, audit, upload, upload-url, notify, push/*).
- OLD PAGE RENAME: `app/(dashboard)/pallet-records/page.tsx` (Sheets photos viewer) →
  `app/(dashboard)/pallet-photos/page.tsx`; sidebar/commandPalette/ALL_MENU_PATHS/PATH_LABELS updated;
  EN "Pallet Photos" / ES "Fotos de Pallets". role_permissions data migration: copy each role's
  '/pallet-records' grant → '/pallet-photos' (run before staging verify).
- ACCESS (mirrors source): profile API also returns `production_access` from `users` table
  (id=user, app='production') → {role,status}. lib/use-pallet-access.ts (client) +
  lib/pallets/guard.ts resolvePalletActor (server): canView = active production user OR molding
  admin; isAdmin = production admin OR molding admin. AccessGuard special-cases /pallet-records/*
  BEFORE generic canAccess (legacy '/pallet-records' role_permissions grants must NOT leak the new
  section). Sidebar: PALLET RECORDS collapsible section gated on canView; admin item on isAdmin.
- Server guards on EVERY API route; admin-only: bulk-update, shipping DELETE, audit restore,
  notify, push/subscribers, users mgmt. NO client-supplied is_admin anywhere.
- Push: reuse dashboard's existing web-push infra if compatible; else port push routes against
  push_subscriptions(app='production') with VAPID env (flag env addition for Vercel).
- QR: keep /pallet-records/scan handler (same localStorage handoff). At CUTOVER (later, on Simon's
  go): redirect entech-production-app.vercel.app/* per-path incl /scan?query passthrough + repoint
  the RT-Labels Apps Script QR_APP_URL (line ~1187) to the dashboard URL.
- i18n: port src/lib/i18n.ts to locales/{en,es}.json under `pallets.*`, ES VERBATIM.
- Keep writing Sheets exactly as source (append/update/DELETED-mark/Main Data H revert).
- bulk-update parity gap (no audit/Sheet sync in source) — keep parity, note for later.

## Phases
A (claude-3): plan, guard, profile production_access, use-pallet-access, AccessGuard, sidebar
  section, old-page rename + permission registry updates. ✅ when committed.
B (Codex): port 3 screens + scan + 14 API routes (guarded) + sheets lib + i18n + upload paths.
C: 4-agent Fable 5 review (security esp.: guards on every route, no client is_admin; Sheet-write
  fidelity vs source; mobile flows) → fixes.
D: role_permissions '/pallet-photos' migration + staging push + deploy verify + desktop/iPad/iPhone
  checks → Simon tests. NO redirect yet.
