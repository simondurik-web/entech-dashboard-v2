# GSD Project: Entech Dashboard V2

**Created:** 2026-02-07
**Status:** 🟡 IN PROGRESS
**Primary Agent:** Claude Code (Opus 4.6)
**Fallback Agents:** Codex CLI (GPT-5.3), Gemini CLI (Gemini 3 Pro)

---

## 🎯 Project Goal

Convert the Molding Operations Dashboard from a static HTML/Google Sheets app to a modern Next.js + Vercel + Supabase application with:
- Real-time data
- User authentication (Google OAuth)
- Write capabilities (replace Google Forms)
- Better maintainability (component-based)

---

## 📋 Phase 1: Foundation (Target: 1-2 weeks)

### Milestone 1.1: Project Scaffold ✅ IN PROGRESS
- [ ] Create Next.js 14 project with App Router
- [ ] Configure Tailwind CSS + shadcn/ui
- [ ] Set up project structure (components, lib, app routes)
- [ ] Create basic layout with dark/light theme
- [ ] Deploy to Vercel (empty shell)

**Success Criteria:** App loads at vercel.app URL with theme toggle

### Milestone 1.2: Google Sheets Connection
- [ ] Create API route for Google Sheets data
- [ ] Implement data fetching (Main Data tab)
- [ ] Add loading states and error handling
- [ ] Cache data appropriately

**Success Criteria:** Dashboard displays live data from Google Sheets

### Milestone 1.3: Orders Page
- [ ] Build OrderCard component
- [ ] Implement mobile card view
- [ ] Add filter chips (All/Urgent/Due/RollTech/Molding/SnapPad)
- [ ] Add search functionality
- [ ] Bilingual support (EN/ES)

**Success Criteria:** Orders page matches current dashboard functionality

### Milestone 1.4: Staged & Inventory Pages
- [ ] Build StagedCard component
- [ ] Build InventoryCard component
- [ ] Add respective filters and search
- [ ] Low stock indicators

**Success Criteria:** All three core pages working

### Milestone 1.5: Phil AI Assistant
- [ ] Create API route for Gemini (server-side, secure key)
- [ ] Build chat UI component
- [ ] Port knowledge base from current dashboard
- [ ] Voice input (Web Speech API)

**Success Criteria:** Phil works same as current dashboard

### Milestone 1.6: Authentication
- [ ] Set up NextAuth.js with Google provider
- [ ] Create login page
- [ ] Protect routes
- [ ] User session management

**Success Criteria:** Google login works, only authenticated users see dashboard

---

## 📋 Phase 2: Database Migration (Target: Week 3-4)

### Milestone 2.1: Supabase Setup
- [ ] Create Supabase project
- [ ] Design database schema
- [ ] Set up Row Level Security (RLS)

### Milestone 2.2: Data Migration
- [ ] Write migration scripts
- [ ] Import historical data
- [ ] Validate data integrity

### Milestone 2.3: CRUD Operations
- [ ] Create API routes for create/update/delete
- [ ] Build admin UI for data management
- [ ] Implement mapping tables (replace Sheets lookups)

### Milestone 2.4: Forms Integration
- [ ] In-app staging form (replace Google Form)
- [ ] Photo upload to Vercel Blob
- [ ] Real-time updates

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js + Google OAuth |
| AI | Gemini API (server-side) |
| Hosting | Vercel |
| Storage | Vercel Blob (photos) |

---

## 📁 Project Structure

```
entech-dashboard-v2/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── orders/page.tsx
│   │   ├── staged/page.tsx
│   │   ├── inventory/page.tsx
│   │   └── layout.tsx
│   ├── api/
│   │   ├── sheets/route.ts
│   │   ├── chat/route.ts
│   │   └── auth/[...nextauth]/route.ts
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/ (shadcn)
│   ├── cards/
│   │   ├── OrderCard.tsx
│   │   ├── StagedCard.tsx
│   │   └── InventoryCard.tsx
│   ├── filters/
│   ├── chat/
│   └── layout/
├── lib/
│   ├── google-sheets.ts
│   ├── gemini.ts
│   ├── auth.ts
│   └── utils.ts
├── hooks/
├── types/
├── public/
├── .env.local
└── package.json
```

---

## 🔄 Agent Handoff Protocol

If primary agent (Claude Code) hits usage limits:
1. Save current progress to `PROGRESS.md`
2. Commit all changes with descriptive message
3. Document next steps clearly
4. Marco switches to Codex or Gemini CLI
5. New agent reads `PROGRESS.md` and continues

---

## 📊 Progress Log

### 2026-02-07
- 13:12 EST: Project initialized
- Status: Starting Milestone 1.1

---

## 🔗 References

- Current dashboard: `~/clawd/projects/molding/`
- Google Sheet ID: `1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw`
- Gemini API key: `~/clawd/projects/molding/gemini-api-key.txt`
