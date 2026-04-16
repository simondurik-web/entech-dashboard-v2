# BOM Lead Time & Change Tracking System
**Project:** entech-dashboard-v2
**Branch:** feature/bom-change-tracking
**Staging:** https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/bom
**Supabase:** mqfjmzqeccufqhisqpij

## Phase Tracker
- [ ] Phase 1: Database Setup
- [ ] Phase 2: BOM Table UI Updates
- [ ] Phase 3: History UI
- [ ] Phase 4: Impact Tracking

## Overview
Track when BOM costs change, which products are affected, and material lead times.

## Phase 1: Database Setup
Add columns to existing tables and create history table.

New columns:
- bom_individual_items: lead_time (integer, days), last_changed (timestamptz)
- bom_sub_assembly: last_changed (timestamptz)
- bom_final_assembly: last_changed (timestamptz)

New table -- bom_cost_history:
- id (uuid, primary key, default gen_random_uuid())
- bom_item_id (uuid, references source item)
- item_type (text: 'individual', 'sub', 'final')
- changed_field (text: 'unit_cost', 'lead_time', etc.)
- old_value (numeric)
- new_value (numeric)
- changed_by (text)
- changed_at (timestamptz, default now())
- affected_assemblies (jsonb, array of assembly IDs impacted)

Backfill last_changed with current date for all existing rows.

## Phase 2: BOM Table UI Updates
- Add editable "Lead Time" column next to unit cost (individual items only)
- Add read-only "Last Changed" column on all 3 BOM tables
- When cost or lead time is edited: compare old vs new value
  - If different: write history record to bom_cost_history
  - Update last_changed timestamp on the item
- Auto-refresh display after save

## Phase 3: History UI
- Add history button on individual items, sub-assemblies, AND final assemblies
- Button opens modal/drawer with:
  - Timeline view (list of changes with dates)
  - Cost graph over time (recharts line chart)
  - Clickable entries showing: field changed, old value, new value, who, when
- Close button returns to BOM table

## Phase 4: Impact Tracking
- When an individual item cost changes:
  - Find all sub-assemblies that use this item
  - Find all final assemblies that use those sub-assemblies
  - Recalculate their total costs
  - Update their last_changed timestamps
  - Store affected assembly IDs in the bom_cost_history record
- Show affected items in the history detail view
