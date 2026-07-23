# Phase B addendum (read with SPEC-shipments-build.md Phase B)

Phase A landed (see DONE-A.md). Notes that supersede/clarify the main spec for Phase B:

1. The two print routes stopped in Phase A are being written by the DIRECTOR in parallel
   with your Phase B work — do NOT create them. Build the UI against these contracts:
   - `GET /api/shipments/print/stations` → `{ stations: [{ id, name }] }` (403 if the
     user lacks `shipments:print`).
   - `POST /api/shipments/print` body `{ date, path, station, copies }` →
     `{ queued: <n> }`; 422 `{ error: 'zebra_unsupported' }` for label files; 413 for
     oversized; 400/403 as usual.
   - `GET /api/shipments/print/status?date=` → `{ jobs: [{ id, station_id, status,
     error, created_at, printed_at }] }` (permission `shipments:print`).
2. Director is also extracting the shared explorer/export filter builder into
   `lib/shipments/query.ts` — do NOT touch `app/api/shipments/explorer/route.ts` or
   `export/route.ts`; their request/response contracts stay exactly as they are now
   (read them for the shapes).
3. Explorer facets: the route returns `facets` on every call today; call it normally.
4. Existing response shapes to build against (READ these files, they exist):
   `app/api/shipments/summary/route.ts` (ShipmentSummary from lib/shipments/types.ts),
   `volume/route.ts` (`{ buckets, parts, totals }`), `deliverables/route.ts`
   (`{ date, files }`), `deliverables/sign/route.ts` (POST `{ path }` → `{ url }`).
5. All client fetches to these routes MUST send `authHeaders()` (lib/session-token.ts).
6. Files you own in Phase B (touch nothing else): `app/(dashboard)/shipments/**`,
   `components/shipments/**` (new, if you want shared components),
   `components/layout/Sidebar.tsx`, `app/(dashboard)/layout.tsx`,
   `app/(dashboard)/admin/permissions/page.tsx`, `locales/en.json`, `locales/es.json`,
   `DONE-B.md`.
7. The types in `lib/shipments/types.ts` are canonical — import them, do not redeclare.
