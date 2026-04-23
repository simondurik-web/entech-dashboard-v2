# Finished Product Reference — BOM Expand Row — Handoff Document
> Session: 2026-04-23
> Final state: **shipped to production via PR #100**

---

## What this feature is

On the Finished Product Reference table (`/fp-reference`), a chevron next to each **Part number** expands the row into the same two-column BOM panel already used on `/customer-reference`. The Tire and Hub columns each carry an inventory popover and a drawing icon, so the sales team can see stock levels and drawings without leaving the table.

Has-BOM vs no-BOM is glanceable at two levels:

- **Chevron:** primary-filled for parts with a BOM, muted grey dash for parts without. Both still click to expand (no-BOM shows the existing "No bill of materials" empty state with a link to `/bom`).
- **Row:** has-BOM rows get a subtle `border-l-2 border-l-emerald-500/40` left stripe.

A stats strip at the top shows the running With-BOM / Without-BOM split so the user can see coverage immediately.

---

## Live URLs

| Env | URL |
|-----|-----|
| Production | https://entech-dashboard-v2.vercel.app/fp-reference |
| Staging | https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/fp-reference |

---

## What shipped (one PR, two commits)

### PR #100 — `feat(fp-reference): expandable BOM panel + tire/hub inventory + drawings`

- Feat commit `0526012` — 257-line rewrite of the previously 90-line page. Same three hooks pulled in: `BomExpandPanel`, `DrawingIconButton`, `InventoryPopover`, `fetchBomMaps`. Nothing duplicated.
- Fix commit `4f0c50e` — addressed all three must-fix findings from the 3-agent review before merge (see review section).
- Merge commit `767239e` — merged into `staging`; staging fast-forwarded to `main` via the documented detach-HEAD recipe.

---

## Files touched

### New
- `HANDOFF-fp-reference-bom-expand.md` — this doc

### Modified
- `app/(dashboard)/fp-reference/page.tsx` — 90 → 257 lines. Added BOM prefetch, WeakMap row-key disambiguation, chevron column render, per-cell tire/hub icons, has-BOM row stripe, With-BOM / Without-BOM stats.
- `locales/en.json` / `locales/es.json` — +4 keys each (`fpRef.hasBomTooltip`, `fpRef.noBomTooltip`, `fpRef.withBom`, `fpRef.withoutBom`). Parity 496 / 496.
- `CONTEXT.md` — Recent Activity entry for 2026-04-23.

### Untouched
- `components/customer-reference/` — same components, zero changes
- `lib/customer-reference-bom.ts` — generic `fetchBomMaps` reused as-is (the filename is mildly misleading now that two pages consume it; a follow-up rename to `lib/bom-expand-data.ts` would be mechanical)
- BOM Explorer, customer-reference page, all API routes, all migrations — not touched

---

## Architecture decisions worth remembering

1. **Three sheet-column headers are matched by exact string** (`'Part number'`, `'Tire'`, `'Hub'`). A rename in the Google Sheet silently degrades the special-cased render back to the generic one — no crash, just loss of feature. Acceptable for a stable internal sheet; revisit if sheet churn becomes a thing.

2. **WeakMap for row keys.** The page has no `id` column. Raw PN as a row key breaks in two ways: duplicate PNs expand together (both rows' chevrons flip), and empty PNs cause the cell render's `expandedRowKey === pn` to disagree with DataTable's `expandedRowKey === rowKey`. A `WeakMap<FPRecord, string>` keyed on row-object identity, computed once per data load as `${pn || 'row'}-${index}`, makes all three sites (cell render, `getRowKey`, DataTable's internal comparison) agree.

3. **Empty-PN rows skip the chevron.** There's no BOM to resolve against an empty string, so the chevron would just toggle a cell-local icon without ever matching a row in the DataTable. Rendering `—` instead is honest.

4. **Prefetch model reused from customer-reference.** Four parallel fetches (`/api/bom/final-assemblies`, `/api/bom/sub-assemblies`, `/api/bom/individual-items`, `/api/drawings`) at mount → O(1) Map lookups on expand. AbortController held in a `useRef` so Retry cancels the prior in-flight fetch.

5. **Tire inventory works even though PNs are short-form.** Tire values are things like `"261"` — short codes. Both `inventory_reference.part_number` and `production_totals.part_number` store these under the same short form (verified against `/api/inventory` during review). Same pattern used by `/orders`, `/staged`, `/need-to-package`, `/drawings`. Hub PNs are full (e.g. `H18.170.1981B`) and also resolve cleanly.

6. **`eslint-disable-next-line react-hooks/set-state-in-effect` is retained.** The byte-identical effect block on `/customer-reference` lints clean; on `/fp-reference` it fires. Opus diagnosed this empirically as a rule-heuristic quirk — React 19's transitive-call analysis bails out on large complex components but completes on smaller ones. Not a behavior difference; the suppression is legitimate.

---

## 3-agent review findings (all addressed before merge)

Codex 5.4 + Gemini 3.1 + Opus 4.7 ultrathink all ran in parallel. Convergent must-fixes, all landed in commit `4f0c50e`:

1. **Codex:** chevron's `title` / `aria-label` didn't flip to "collapse" when the row was expanded — a11y regression from customer-reference. Fixed by adding an `isOpen` branch that reuses the existing `customerRef.collapseRow` key.
2. **Opus + Codex + Gemini:** row-key uses PN → duplicates collide and empty PNs cause phantom-panel toggles. Fixed with `WeakMap<FPRecord, string>`.
3. **Gemini:** empty-PN rows still offered a clickable chevron. Fixed by early-returning `—` for empty PNs.

Minor cleanups:
- Dropped `tirePartLabel()` identity helper (Opus + Gemini noted it was dead code).
- Tightened the `eslint-disable` comment to accurately describe the rule-heuristic reason.

Non-findings (reviewers confirmed these were fine):
- Tire/hub lookups — short codes like "261" live in both `inventory_reference` and `production_totals` under that exact form. Opus cross-verified against `/orders`, `/staged`, `/need-to-package`, `/drawings`.
- Exact-string header coupling — acceptable for an internal sheet.
- `columns` useMemo recreation on expand — 362 × 28 is cheap; identical to the customer-reference baseline.

---

## Follow-ups worth eyeballing

1. **`lib/customer-reference-bom.ts` rename.** Now consumed by two pages (and probably more to come); `lib/bom-expand-data.ts` would read better. Mechanical rename + import update.
2. **Column match robustness.** If Google Sheet header hygiene becomes a concern, swap the three `===` checks for a normalized lookup (trim + case-insensitive) or surface a "missing expected header" warning.
3. **Export ties out.** The DataTable CSV/Excel export currently exports the three special-cased columns — they'll have the raw PN/tire/hub string, not the rendered icons. That's what we want for exports. Worth a re-check once the feature is in real use.

---

## For fresh-context recovery

- Worktree at `/Users/simondurik/clawd/projects/customer-ref-bom-dropdown` (the old feature-branch name is a historical artifact; staging + main both have the full feature).
- PRs #96 (BOM expand, customer-reference) + #97 (drawing carousel) + #100 (FP reference) are all merged.
- `HANDOFF-customer-ref-bom-expand.md` covers the original pattern; this doc covers the extension onto FP Reference.
- Deploy workflow note: `.git/hooks/pre-push` blocks pushes **while the current branch is `staging`**, so staging → main promotion uses `git checkout --detach && git push origin <staging-sha>:refs/heads/main`. Full recipe in `CONTEXT.md § "Pre-push hook — quirk + promotion workaround"`.
- Global bilingual rule is persisted in `~/.claude/CLAUDE.md`, `~/clawd/LESSONS.md`, and auto-memory — any session with any bilingual Simon product picks it up automatically.
