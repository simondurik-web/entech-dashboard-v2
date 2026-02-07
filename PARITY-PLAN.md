# Dashboard V2 Parity Plan

**Goal:** Make V2 identical to the original dashboard
**Created:** 2026-02-07 18:27 EST
**Status:** 🔄 In Progress

---

## 📋 Gap Summary

### Missing Pages (8)
| # | Page | Priority | Complexity | Status |
|---|------|----------|------------|--------|
| 1 | sales-overview | Low | Medium | ⬜ TODO |
| 2 | sales-parts | Low | Medium | ⬜ TODO |
| 3 | sales-customers | Low | Medium | ⬜ TODO |
| 4 | sales-dates | Low | Medium | ⬜ TODO |
| 5 | all-data | Low | Low | ⬜ TODO |
| 6 | fp-reference | Low | Low | ⬜ TODO |
| 7 | customer-reference | Low | Low | ⬜ TODO |
| 8 | quotes-registry | Low | Low | ⬜ TODO |

### Feature Gaps (4)
| # | Feature | Priority | Complexity | Status |
|---|---------|----------|------------|--------|
| 1 | BOM tabs (Final/Sub/Individual) | High | Low | ⬜ TODO |
| 2 | Real inventory history data | High | Medium | ⬜ TODO |
| 3 | Zoom controls | Low | Low | ⬜ TODO |
| 4 | Phil AI Assistant | Medium | High | ⬜ TODO |

### Polish Items (3)
| # | Item | Priority | Status |
|---|------|----------|--------|
| 1 | Auto-refresh (5 min interval) | Medium | ⬜ TODO |
| 2 | Photo gallery on records | Low | ⬜ TODO |
| 3 | Password-protected sections | Low | ⬜ TODO |

---

## 🎯 Phases

### Phase 1: Core Feature Parity (HIGH PRIORITY)
**Goal:** Fix the most visible/used features first

#### 1.1 BOM Tabs ✅ DONE
- [x] Add tab component to BOM page
- [x] Create 3 tabs: Final Assembly, Sub Assembly, Individual Items
- [x] Connect each tab to correct Google Sheet GID
- [ ] Test: All 3 tabs load data correctly (pending live test)
- **Completed:** 2026-02-07 18:45 EST (Codex)

#### 1.2 Real Inventory History
- [ ] Create /api/inventory-history endpoint
- [ ] Connect to actual historical data (or snapshot approach)
- [ ] Add date range picker
- [ ] Add stats panel (current, min, max, avg)
- [ ] Test: Chart shows real data, date picker works
- **Estimated:** 1 hour

### Phase 2: Refresh & Polish (MEDIUM PRIORITY)
**Goal:** Better UX and reliability

#### 2.1 Auto-Refresh
- [ ] Create useAutoRefresh hook
- [ ] Add to all data pages (Orders, Staged, Shipped, Inventory)
- [ ] Show "Last updated" timestamp
- [ ] Configurable interval (default 5 min)
- [ ] Test: Data refreshes automatically
- **Estimated:** 30 min

#### 2.2 Phil AI Assistant
- [ ] Create chat drawer/modal component
- [ ] Connect to chat API endpoint
- [ ] Add to sidebar button action
- [ ] Test: Can ask questions, get responses
- **Estimated:** 2 hours

### Phase 3: Sales & Finance (LOW PRIORITY)
**Goal:** Complete feature set (password-protected)

#### 3.1 Sales Overview Page
- [ ] Create /sales-overview page
- [ ] Add P/L summary cards
- [ ] Add charts (revenue, profit trends)
- [ ] Connect to Google Sheet data
- [ ] Test: Shows real financial data

#### 3.2 Sales by Part Page
- [ ] Create /sales-parts page
- [ ] DataTable with part-level P/L
- [ ] Test: Filters and sorts work

#### 3.3 Sales by Customer Page
- [ ] Create /sales-customers page
- [ ] DataTable with customer-level P/L
- [ ] Test: Filters and sorts work

#### 3.4 Sales by Date Page
- [ ] Create /sales-dates page
- [ ] DataTable with date-level P/L
- [ ] Test: Date filters work

#### 3.5 Password Protection
- [ ] Create password modal component
- [ ] Store unlock state in session
- [ ] Protect Sales section
- [ ] Test: Can't access without password

### Phase 4: Raw Data Pages (LOW PRIORITY)
**Goal:** Admin/debug access to raw data

#### 4.1 All Data Page
- [ ] Create /all-data page
- [ ] Show complete order dataset
- [ ] Full column visibility
- [ ] Test: All columns visible, export works

#### 4.2 FP Reference Page
- [ ] Create /fp-reference page
- [ ] Connect to FP Reference sheet
- [ ] Test: Data loads correctly

#### 4.3 Customer Reference Page
- [ ] Create /customer-reference page
- [ ] Connect to Customer Reference sheet
- [ ] Test: Data loads correctly

#### 4.4 Quotes Registry Page
- [ ] Create /quotes-registry page
- [ ] Connect to Quotes sheet
- [ ] Test: Data loads correctly

### Phase 5: Final Polish (OPTIONAL)
**Goal:** Nice-to-have features

#### 5.1 Zoom Controls
- [ ] Add zoom in/out/reset buttons
- [ ] Store zoom preference
- [ ] Test: Zoom persists across pages

#### 5.2 Photo Gallery Enhancement
- [ ] Better lightbox for photos
- [ ] Swipe navigation on mobile
- [ ] Test: Can browse photos easily

---

## ✅ Testing Checklist

### Per-Page Tests
For each page, verify:
- [ ] Page loads without errors
- [ ] Data fetches from API
- [ ] Filters work correctly
- [ ] Sort works correctly
- [ ] Search works correctly
- [ ] Mobile view is usable
- [ ] Refresh button works
- [ ] CSV export works (if applicable)

### Cross-Page Tests
- [ ] Navigation between pages works
- [ ] Theme toggle persists
- [ ] Language toggle persists
- [ ] No console errors
- [ ] Build passes (`npm run build`)
- [ ] Deploy succeeds

### Mobile Tests
- [ ] Bottom nav works
- [ ] Cards display correctly
- [ ] Touch interactions work
- [ ] No horizontal scroll issues

---

## 📝 Execution Log

### Session: 2026-02-07

**18:27** - Created PARITY-PLAN.md
- Documented all gaps
- Created phased approach
- Defined testing criteria

**18:30** - Phase 1.1 BOM Tabs
- Claude Code: Hung with zero output (killed after ~60s)
- Codex: SUCCESS! Created tabs + API endpoints
- Build passes, deployed to Vercel

**Next:** Phase 1.2 (Real Inventory History)

---

## 🔧 Agent Commands

```bash
# Claude Code (default)
env -u ANTHROPIC_API_KEY claude -p "task" --print --max-turns 15 --permission-mode bypassPermissions

# Codex (fallback)
codex exec --full-auto "task"

# Always use pty:true from Clawdbot
```

---

## 📊 Progress Tracker

| Phase | Items | Done | % |
|-------|-------|------|---|
| Phase 1 | 2 | 1 | 50% |
| Phase 2 | 2 | 0 | 0% |
| Phase 3 | 5 | 0 | 0% |
| Phase 4 | 4 | 0 | 0% |
| Phase 5 | 2 | 0 | 0% |
| **Total** | **15** | **1** | **7%** |

---

*Last Updated: 2026-02-07 18:27 EST*
