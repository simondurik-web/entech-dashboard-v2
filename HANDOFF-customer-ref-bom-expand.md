# Customer Reference — BOM Expand Row — Handoff Document
> Session: 2026-04-22 evening → 2026-04-23 early morning
> Final state: **shipped to production via PRs #96 + #97**

---

## What this feature is

On the Customer Reference table (`/customer-reference`), clicking the small chevron next to any **Internal P/N** expands the row into a two-column panel styled to match the BOM Explorer:

- **Left (2/3 width)** — components table with Part · Source badge · Qty · Unit Cost · Ext. Cost, plus two per-row action icons:
  - 🔍 **Inventory** — reuses the existing `<InventoryPopover/>` (60s cache stays untouched)
  - 📄 **Drawing** — opens a dialog lightbox that **carousels through all drawings** the part has (most hubs/tires ship two)
- **Right (1/3 width)** — Cost Breakdown card: read-only mirror of what BOM Explorer shows (Subtotal, Overhead%, Admin%, Depreciation%, Repairs%, Variable, Total, Sales Target). Edits stay in BOM Explorer — **no dual-write from two places**.

If the Internal P/N has no matching BOM in any of the three tiers (final assembly / sub assembly / individual item), the panel shows a friendly empty state with a link to `/bom` so the user can create one.

A small amber `+N` badge appears when a PN resolves in more than one tier — data-hygiene signal, doesn't block anything.

---

## Live URLs

| Env | URL |
|-----|-----|
| Production | https://entech-dashboard-v2.vercel.app/customer-reference |
| Staging | https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/customer-reference |

---

## What shipped (two PRs)

### PR #96 — `feat(customer-ref): expandable BOM panel w/ inventory + drawing icons`
- **Merge commit:** `11b09728` → staging, then fast-forwarded to main
- **3-agent review ran:** Codex 5.4, Gemini 3.1, Opus 4.7 ultrathink
- All three independently flagged the same blocker: my first `/api/drawings` type was wrong (`drawing1Url`/`drawing2Url` vs the real `drawingUrls: string[]`). Fixed before merge in commit `ffbcf71`.
- Also from review: sanitize drawing URLs against `javascript:` / `data:` schemes (Sheet-editable input), AbortController tracked in ref so Retry doesn't stack requests, `aria-controls` on chevron, `role="region"` on panel in every state.

### PR #97 — `feat(customer-ref): drawing viewer carousels through all URLs`
- **Merge commit:** `61909b02` → staging, then fast-forwarded to main
- After looking at live data, Simon noticed parts usually have 2 drawings and v1 was only showing the first.
- Now the viewer dialog has: prev/next chevrons, "N / total" counter, thumbnail strip, ArrowLeft/ArrowRight keyboard nav, single-drawing parts keep the minimal dialog.
- Lint fix bundled: reset of `idx` on dialog open moved from `useEffect` to the Dialog's `onOpenChange` (React 19 no longer tolerates setState-in-effect).

---

## Files touched

### New
- `components/customer-reference/BomExpandPanel.tsx` — the two-column panel + all empty/loading/error states
- `components/customer-reference/DrawingIconButton.tsx` — the 📄 icon + carousel dialog
- `lib/customer-reference-bom.ts` — `DrawingLite`, `FinalAssemblyLite`, `SubAssemblyLite`, `IndividualItemLite`, `sanitizeDrawingUrl`, `fetchBomMaps`

### Modified
- `app/(dashboard)/customer-reference/page.tsx` — chevron column render, `expandedRowId` state, `loadBomMaps` with AbortController ref, DataTable expansion props
- `locales/en.json` / `locales/es.json` — +42 new keys in each file (both locales stay at 492 keys, parity verified)

### Untouched
- No API routes changed
- No Supabase migrations
- No changes to BOM Explorer page (`app/(dashboard)/bom/page.tsx`)
- No changes to Drawings page or its `CarouselLightbox` (we built a scoped carousel instead of trying to export that one)

---

## Architecture decisions worth remembering

1. **Prefetch all BOMs + drawings at mount** rather than lazy-fetch per expand. Four parallel requests once (`/api/bom/final-assemblies`, `/api/bom/sub-assemblies`, `/api/bom/individual-items`, `/api/drawings`) → builds `Map<partNumber, T>` lookups, so expanding a row is O(1) with no spinner.
   - Codex + Gemini suggested lazy-fetch on first expand. Kept prefetch for responsiveness on a daily-use editing page; total payload is modest (~500KB–1MB gzipped across all four endpoints). Easy to revisit if staging shows a problem.

2. **Tier resolution priority: final → sub → individual.** When a PN matches in multiple tables, the final assembly wins because that's almost always what the user actually cares about. The amber `+N` badge warns about collisions so the user isn't misled silently.

3. **Row-click-to-edit preserved.** The chevron uses `stopPropagation` so clicking it *only* toggles expansion. Clicking the rest of the row still opens the edit dialog, which is the existing daily-use UX.

4. **Cost Breakdown is read-only on this page.** The BOM Explorer is the single source of truth for editing overheads, labor, profit target, etc. Displaying the same numbers here is fine; letting people edit them from two places is not.

5. **Bilingual from day one.** Every user-facing string lives in both `locales/en.json` and `locales/es.json` in the same commit. This rule is now persisted globally (see below).

---

## Global rule persisted this session

**Any Simon product that ships multiple locales must have every new user-facing string in all locales, in the same commit. No English-only shipping with "ES later."**

Persisted in three places so future sessions will always pick it up:
- `~/.claude/projects/-Users-simondurik-clawd/memory/feedback_bilingual_en_es.md` (+ MEMORY.md index)
- `~/clawd/LESSONS.md` (new `## i18n` section)
- `~/.claude/CLAUDE.md` — added to operational rules

---

## Review fleet wiring notes

- `~/clawd/.clawdbot/review-pr.sh` is the orchestrator. It spawns each reviewer in its own tmux session.
- **One gotcha:** the script inlines the full PR diff into the tmux session command, which blows past the ARG_MAX shell limit for moderately large PRs ("command too long"). Workaround used this session: write a short prompt to a file, then invoke each CLI directly (`codex exec`, `gemini -p`, and the `Agent` tool for Opus) telling the reviewer to `gh pr diff <num>` themselves. Worth either (a) patching the script to stream the diff via stdin, or (b) adding a `--prompt-file` flag.
- The Opus ultrathink reviewer was launched via the `Agent` tool with `model: "opus"` and a detailed brief — not via the shell script. That's the richest review of the three and should probably be the default for any non-trivial PR going forward.

---

## Follow-ups worth eyeballing

1. **Prefetch size monitoring.** If the BOM tables grow past ~2k total items, reconsider lazy-fetch.
2. **Multi-tier collision badge UX.** Currently a compact amber `+N` with a tooltip. If collisions turn out to be common, consider a richer "this PN also exists in X, Y" panel.
3. **Drawing carousel on other pages.** The pattern we shipped (prev/next + thumbnails + keyboard nav + lightbox) is more polished than the `OrderDetail` "click thumbnail to open a plain lightbox" pattern. Could factor into a shared `DrawingCarouselDialog` component if another page wants it.
4. **`feat/customer-ref-bom-dropdown` branch.** The old stale branch was reset to main at session start. The worktree is still rooted at it. Delete the branch (and optionally the worktree) when convenient.

---

## For fresh-context recovery

If `/clear` happens and someone asks "where did we leave off on customer-reference":

- Working directory of the worktree is `/Users/simondurik/clawd/projects/customer-ref-bom-dropdown`
- Both PRs are merged into `main` and `staging`
- No open PRs for this feature
- `git log --oneline main -5` should show the merge commits for #96 and #97
- `.env.local` was copied from the parent project dir during the session; it's in `.gitignore`, should stay

Anything broken, check the Vercel deploy logs: https://vercel.com/simons-projects-849cf04c/entech-dashboard-v2 — the staging-alias workflow also logs to GitHub Actions if the URL ever stops pointing at the latest staging commit.
