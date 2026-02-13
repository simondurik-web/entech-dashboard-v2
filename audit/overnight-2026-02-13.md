# Overnight Parity Work — 2026-02-13

**Started:** 12:30 AM EST
**Goal:** Match V1 molding dashboard features in V2 (Next.js)
**Base commit:** f098800
**Base tag:** before-overnight-parity-20260213

---

## Phase Log

### Phase 1: Zoom Controls
**Time:** 00:31 AM EST
**Files changed:**
- `components/layout/ZoomControls.tsx` — **NEW** — Zoom +/-, reset buttons with localStorage persistence (key: `dashboard-zoom`), range 0.5–2.0x, hidden on mobile
- `components/layout/Sidebar.tsx` — Added `<ZoomControls />` between toggle controls and nav
- `app/(dashboard)/layout.tsx` — Reads zoom from localStorage, listens for `zoom-changed` custom event, applies `zoom` CSS to `<main>`
**Build:** ✅ Passes


## Password Protection for Sales Pages

**Added:** `components/SalesPasswordGate.tsx`
- Client component wrapping sales page content
- Checks `sessionStorage('salesUnlocked')` on mount
- Modal overlay with lock icon, password input, submit button (shadcn Card/Input/Button)
- Hash validation: `hashCode(password) === 2001594324` (password: `Sales@@@`)
- Shake animation on wrong password, error message
- Once unlocked, persists for session via sessionStorage

**Modified:**
- `app/(dashboard)/sales-overview/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/(dashboard)/sales-parts/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/(dashboard)/sales-customers/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/(dashboard)/sales-dates/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/globals.css` — added shake keyframe animation

**Build:** ✅ Passes

## Material Requirements Page

### Added Files:
- `app/api/material-requirements/route.ts` — API route that computes material requirements by:
  - Fetching open orders, BOM Sub-Assembly data, and inventory in parallel
  - Extracting hub/tire demand from pending orders
  - Looking up BOM sub-assembly components to calculate raw material needs (lbs)
  - Comparing against inventory for surplus/shortage/coverage status
  - Returns summary stats, material table, hub breakdown, and tire breakdown

- `app/(dashboard)/material-requirements/page.tsx` — Full page with:
  - Summary cards (open orders, hubs needed, tires needed, shortages, urethane, crumb rubber)
  - Search bar for filtering materials
  - Category filter chips (All / Roll Tech / Molding / Snap Pad)
  - Material cards with on-hand, needed, surplus/shortage, coverage bar, status badge
  - Expandable demand breakdown per material (grouped by component)
  - Hub Production Breakdown table
  - Tire Production Breakdown table
  - CSV export
  - Refresh button

### Modified Files:
- `components/layout/Sidebar.tsx` — Added "Material Requirements" nav item after BOM Explorer (with Package icon, as sub-item)

### Build: ✅ Passes
