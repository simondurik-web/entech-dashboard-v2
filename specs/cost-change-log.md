# Cost Change Log - BOM Explorer

**Project:** entech-dashboard-v2
**Created:** 2026-04-17
**Branch:** `claude/agitated-greider-8f10ca`
**Status:** In Progress

---

## Overview

Add a unified **Cost Change Log** tab to the BOM Explorer page that shows a
single timeline of all cost (and lead time) changes across every BOM item
(individual, sub-assembly, final assembly) — so users don't need to click into
each item's history individually to find recent changes.

## User Story

> "Right now, I can click the history button on each individual item to see
> its changes, but if there were 20 changes across different items, I have to
> click each one to find them. I want one single view where I can see
> everything at a glance."

## Requirements

- New tab next to "Individual Items", "Sub-Assemblies", "Final Assemblies"
- Table sorted by date (most recent first)
- Columns: date, part number/name, item type, changed field, old value, new
  value, % change, changed by
- Color code: green for decrease, red for increase
- Expandable rows → show affected assemblies (for individual changes, which
  sub/final assemblies contain that item)
- Filters: date range, item type (individual/sub/final), change type
- Search: part number or description
- Reuse existing `bom_cost_history` / `bom_cost_history_with_details` data

## Data Source

`bom_cost_history_with_details` view already exposes:
- `id, bom_item_id, item_type, changed_field, old_value, new_value`
- `changed_by, changed_at, affected_assemblies`
- `part_number, item_description`

Lead time tracking: Current triggers (`20260416_bom_cost_tracking_triggers_views.sql`)
only track numeric cost fields. Lead time is already numeric, so can reuse the
same table — **Phase 1 extends the individual-item trigger to also record
`lead_time` changes** under `changed_field = 'lead_time'`.

---

## Phase Tracker

### Phase 1: API + lead_time tracking — ⬜ Pending
- [ ] Migration: extend `track_individual_item_changes()` to also record
      `lead_time` changes into `bom_cost_history`.
- [ ] `GET /api/bom/cost-history` endpoint — returns all entries with
      filters: `?limit=500&from=ISO&to=ISO&item_type=individual|sub|final&change_type=cost|lead_time&q=search`
- [ ] Response shape: `{ entries: CostChangeLogEntry[], total, limit }`
- [ ] Server-side filtering/ordering (changed_at DESC)
- [ ] Test: returns recent entries with joined part numbers

### Phase 2: Cost Change Log tab UI — ⬜ Pending
- [ ] Add 4th tab "Cost Change Log" in `app/(dashboard)/bom/page.tsx`
- [ ] New `CostChangeLogTab` component — client-side fetch on mount
- [ ] Table with columns: Date, Part Number, Type, Field, Old, New, % Change,
      By, Actions
- [ ] Color code +/- changes (red/green)
- [ ] Date range + item type + change type filters
- [ ] Search input (part number / description)
- [ ] Loading / error / empty states matching dashboard conventions

### Phase 3: Expandable rows + affected assemblies — ⬜ Pending
- [ ] Click row → expands to show `affected_assemblies` (parent assemblies
      for individual-item changes)
- [ ] Show cause chain for sub/final entries when data is available
- [ ] Hook up existing top-level search box so it filters this tab too
- [ ] Polish: keyboard nav, empty-state copy, column widths

### Phase 4 (after): Merge to staging
- [ ] `gh pr create --base staging`
- [ ] After merge, update staging alias
- [ ] Update CONTEXT.md with what was built

---

## Context Budget

- Check context before each phase; if above 55%, stop and report.

## Non-Goals (v1)

- No chart (existing per-item CostHistoryPanel already has one; this view is
  table-first)
- No write actions — read-only audit view
- No CSV export in v1 (can add later via `lib/export-utils.ts`)
- No component-level attribution beyond the existing `affected_assemblies`
  JSONB field
