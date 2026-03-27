# Design Polish — Complete Implementation Guide (25 Improvements)

25 design improvements for Next.js + Tailwind + shadcn/ui dashboards. **#1–15 are implemented** on Entech Dashboard V2. **#16–25 are proposed** (ready to build). Each is independent — copy what you need.

**Dependencies added:** `framer-motion`, `lenis`

```bash
npm install framer-motion lenis
```

---

## 1. Staggered Table Row Entrance

Rows cascade in with a fade-slide animation. Applied to first 25 rows only (avoids delay on large datasets).

**CSS (globals.css):**
```css
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0s !important; animation-delay: 0s !important; }
}
```

**TSX (on each `<tr>` in tbody):**
```tsx
style={idx < 25 ? { animation: `fadeSlideIn 300ms ease-out ${idx * 30}ms both` } : undefined}
```

---

## 2. Sidebar Active Pill Animation (framer-motion)

The active highlight slides between nav items instead of hard-cutting. Uses `layoutId` for shared layout animation.

**Import:**
```tsx
import { motion, LayoutGroup } from 'framer-motion'
```

**On each nav link (`<Link>`):**
- Add `relative` and `overflow-hidden` to the link's className
- Remove any existing active background class (e.g. `bg-white/15`)
- Add this inside the link, before the icon:

```tsx
{isActive && (
  <motion.div
    layoutId="activePill"
    className="absolute inset-0 rounded-lg bg-white/15 shadow-sm shadow-white/5 border-l-2 border-white/70"
    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
  />
)}
```

- Add `relative` to the icon `<span>` and text `<span>` so they render above the pill
- Wrap the entire `<nav>` in `<LayoutGroup>` so the pill animates across sections

---

## 3. Page Transitions (framer-motion AnimatePresence)

Smooth fade + slide on navigation between pages.

**components/ui/page-transition.tsx:**
```tsx
'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

**Usage:** Wrap each page's children in `<PageTransition>` in your dashboard layout.

---

## 4. Sort/Filter Button Micro-Feedback

Sort buttons press in on click. Active filters get a pulsing indicator dot.

**CSS (globals.css):**
```css
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

**TSX (sort buttons):**
```tsx
className="... active:scale-95 transition-transform duration-100"
```

**TSX (active filter indicator):**
```tsx
{hasActiveFilter && (
  <span
    className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary"
    style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
  />
)}
```

---

## 5. Stat Card Hover Lift + Glow

Cards lift slightly and get a colored shadow on hover.

**CSS (globals.css):**
```css
.stat-card-hover {
  transition: transform 200ms ease, box-shadow 200ms ease;
}
.stat-card-hover:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.12);
}
/* Category-specific glow variants */
.stat-card-hover-green:hover { box-shadow: 0 4px 20px rgba(56, 161, 105, 0.12); }
.stat-card-hover-amber:hover { box-shadow: 0 4px 20px rgba(214, 158, 46, 0.12); }
.stat-card-hover-purple:hover { box-shadow: 0 4px 20px rgba(128, 90, 213, 0.12); }
```

**Usage:** Add `stat-card-hover` to any stat card wrapper. Add color variants as needed.

---

## 6. Sparkline Component (Recharts)

Tiny inline trend chart — 40px tall, no axes, no grid.

**components/ui/sparkline.tsx:**
```tsx
'use client'

import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

interface SparklineProps {
  data: number[]
  color?: string
  className?: string
}

export function Sparkline({ data, color, className }: SparklineProps) {
  const chartData = data.map((v, i) => ({ v, i }))
  const isPositive = data.length >= 2 && data[data.length - 1] >= data[0]
  const lineColor = color || (isPositive ? '#38a169' : '#e53e3e')

  return (
    <div className={cn('h-10 w-20', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={lineColor}
            fill={lineColor}
            fillOpacity={0.1}
            strokeWidth={1.5}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

**Usage:**
```tsx
<Sparkline data={[12, 15, 11, 18, 22, 19, 25]} color="#3182ce" />
```

---

## 7. Animated Card Borders (Conic Gradient Rotation)

A slowly rotating gradient border that draws attention to highlighted cards. Opt-in class.

**CSS (globals.css):**
```css
@keyframes border-rotate {
  0% { --angle: 0deg; }
  100% { --angle: 360deg; }
}
@property --angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.card-glow-border {
  position: relative;
  border: 1px solid transparent;
  background-clip: padding-box;
}
.card-glow-border::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: conic-gradient(from var(--angle), transparent 60%, rgba(59,130,246,0.3) 80%, transparent 100%);
  animation: border-rotate 4s linear infinite;
  z-index: -1;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  padding: 1px;
}
```

**Usage:** Add `card-glow-border` to any card you want to highlight.

---

## 8. Table Row Hover Highlight Upgrade

Hover shows a muted background + a blue left-edge accent bar.

**CSS (globals.css):**
```css
.table-row-hover {
  transition: background-color 150ms ease, box-shadow 150ms ease;
}
.table-row-hover:hover {
  background-color: hsl(var(--muted) / 0.4);
  box-shadow: inset 3px 0 0 0 hsl(var(--primary));
}
```

**Usage:** Add `table-row-hover` to each `<tr>` in your table body.

---

## 9. Expandable Row Smooth Animation (framer-motion)

Expanded row content smoothly animates height instead of instant show/hide.

```tsx
import { motion, AnimatePresence } from 'framer-motion'

<AnimatePresence>
  {isExpanded && (
    <tr>
      <td colSpan={columns.length} className="p-0">
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="overflow-hidden"
        >
          <div className="bg-muted/25 px-3 py-3">
            {expandedContent}
          </div>
        </motion.div>
      </td>
    </tr>
  )}
</AnimatePresence>
```

---

## 10. Column Sort Transition (framer-motion layout)

Rows animate to their new positions when sort order changes. Limited to first 50 rows for performance.

```tsx
import { motion, LayoutGroup } from 'framer-motion'

<LayoutGroup>
  <tbody>
    {rows.map((row, i) => (
      <motion.tr
        key={getRowKey(row)}
        layout={i < 50}
        transition={{ duration: 0.2 }}
        className="table-row-hover"
      >
        {/* cells */}
      </motion.tr>
    ))}
  </tbody>
</LayoutGroup>
```

**Note:** Requires stable `key` per row (not index-based).

---

## 11. Grain Texture Overlay

Adds film-grain texture on top of everything. Barely perceptible (2.5% opacity) — adds depth.

**CSS (globals.css):**
```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.025;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
}
@media (prefers-reduced-motion: reduce) {
  body::after { display: none; }
}
```

---

## 12. Glassmorphism Card Variant

Frosted glass effect for cards. Works in both light and dark mode.

**CSS (globals.css):**
```css
.glass-card {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(226, 232, 240, 0.8);
}
.dark .glass-card {
  background: rgba(17, 17, 17, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

**shadcn card.tsx variant (optional):**
Add `variant="glass"` to your Card component and apply `glass-card` class when active.

---

## 13. Typography Refinement

OpenType features for Geist font, tabular numbers in tables, consistent page titles.

**CSS (globals.css):**
```css
body {
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
}

table td { font-variant-numeric: tabular-nums; }

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.2;
}
@media (min-width: 640px) {
  .page-title { font-size: 1.875rem; }
}
```

---

## 14. Toast Notification System (Zero Dependencies)

Event-based toast system — no external toast library needed.

**lib/use-toast.ts:**
```ts
type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastEvent {
  id: string
  title: string
  description?: string
  type: ToastType
}

type ToastListener = (event: ToastEvent) => void

const listeners = new Set<ToastListener>()

export function onToast(listener: ToastListener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let counter = 0

export function toast({ title, description, type = 'info' }: Omit<ToastEvent, 'id'>) {
  const event: ToastEvent = { id: String(++counter), title, description, type }
  listeners.forEach((fn) => fn(event))
}

export type { ToastEvent, ToastType }
```

**components/ui/toast.tsx:**
```tsx
'use client'

import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToastEvent, ToastType } from '@/lib/use-toast'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="size-4 text-green-500" />,
  error: <AlertCircle className="size-4 text-red-500" />,
  warning: <AlertTriangle className="size-4 text-amber-500" />,
  info: <Info className="size-4 text-blue-500" />,
}

const borderColors: Record<ToastType, string> = {
  success: 'border-l-green-500',
  error: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
}

export function Toast({ toast: t, onDismiss }: { toast: ToastEvent; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true)
      setTimeout(() => onDismiss(t.id), 300)
    }, 3000)
    return () => clearTimeout(timer)
  }, [t.id, onDismiss])

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 bg-card p-3 shadow-lg',
        borderColors[t.type]
      )}
      style={{
        animation: exiting ? 'toast-slide-out 300ms ease-in forwards' : 'toast-slide-in 300ms ease-out',
      }}
    >
      <span className="mt-0.5 shrink-0">{icons[t.type]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t.title}</p>
        {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
      </div>
      <button onClick={() => { setExiting(true); setTimeout(() => onDismiss(t.id), 300) }}
        className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
```

**components/ui/toast-provider.tsx:**
```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { onToast, type ToastEvent } from '@/lib/use-toast'
import { Toast } from './toast'

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastEvent[]>([])

  useEffect(() => {
    return onToast((event) => {
      setToasts((prev) => [...prev, event])
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  )
}
```

**CSS (globals.css):**
```css
@keyframes toast-slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes toast-slide-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(100%); opacity: 0; }
}
```

**Setup:** Add `<ToastProvider />` to your root layout.

**Usage anywhere:**
```tsx
import { toast } from '@/lib/use-toast'
toast({ title: 'Saved!', type: 'success' })
toast({ title: 'Error', description: 'Something went wrong', type: 'error' })
```

---

## 15. Smooth Scroll (Lenis)

Buttery smooth scrolling with lerp interpolation.

**components/ui/smooth-scroll.tsx:**
```tsx
'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
    const raf = (time: number) => {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)
    return () => lenis.destroy()
  }, [])

  return <>{children}</>
}
```

**Usage:** Wrap main content area (NOT the sidebar) in `<SmoothScroll>`.

---

---
---

# 🔮 Proposed Improvements (#16–25)

These are designed, not yet implemented. Each is independent and zero performance impact.

---

## 16. Breadcrumb Navigation Bar

A subtle breadcrumb trail below the header: `Dashboard > Production > Orders`. Helps orientation across 20+ pages.

**components/ui/breadcrumb-nav.tsx:**
```tsx
'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'

const pathLabels: Record<string, string> = {
  orders: 'Orders',
  'need-to-make': 'Need to Make',
  'need-to-package': 'Need to Package',
  staged: 'Staged',
  shipped: 'Shipped',
  inventory: 'Inventory',
  'inventory-history': 'Inventory History',
  'sales-overview': 'Sales Overview',
  'sales-parts': 'Sales by Part',
  'sales-customers': 'Sales by Customer',
  'sales-dates': 'Sales by Date',
  bom: 'Bill of Materials',
  scheduling: 'Scheduling',
  labels: 'Labels',
  quotes: 'Quotes',
  drawings: 'Drawings',
  reports: 'Reports',
  admin: 'Admin',
}

const sectionMap: Record<string, string> = {
  orders: 'Production', 'need-to-make': 'Production', 'need-to-package': 'Production',
  staged: 'Production', shipped: 'Production', inventory: 'Production',
  'inventory-history': 'Production', bom: 'Production', scheduling: 'Production',
  labels: 'Production', drawings: 'Production',
  'sales-overview': 'Sales', 'sales-parts': 'Sales', 'sales-customers': 'Sales', 'sales-dates': 'Sales',
  admin: 'Admin', reports: 'Reports', quotes: 'Quotes',
}

export function BreadcrumbNav() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const pageKey = segments[segments.length - 1]
  const section = sectionMap[pageKey]
  const label = pathLabels[pageKey] || pageKey

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
      <Link href="/" className="hover:text-foreground transition-colors">
        <Home className="size-3.5" />
      </Link>
      <ChevronRight className="size-3" />
      {section && (
        <>
          <span>{section}</span>
          <ChevronRight className="size-3" />
        </>
      )}
      <span className="text-foreground font-medium">{label}</span>
    </nav>
  )
}
```

**Usage:** Add `<BreadcrumbNav />` at the top of dashboard layout content area.

---

## 17. Status Badge with Animated Pulse Dots

Pill-shaped status badges where active statuses (WIP, Pending) have a breathing dot. Completed/Shipped stay static.

**components/ui/status-badge.tsx:**
```tsx
'use client'

import { cn } from '@/lib/utils'

const statusConfig: Record<string, { bg: string; text: string; dot: string; animate: boolean }> = {
  pending:   { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', animate: true },
  wip:       { bg: 'bg-teal-100 dark:bg-teal-500/20', text: 'text-teal-700 dark:text-teal-400', dot: 'bg-teal-500', animate: true },
  completed: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', animate: false },
  staged:    { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500', animate: false },
  shipped:   { bg: 'bg-gray-100 dark:bg-gray-500/20', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400', animate: false },
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const config = statusConfig[status.toLowerCase()] || statusConfig.pending

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', config.bg, config.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot, config.animate && 'animate-pulse')} />
      {label}
    </span>
  )
}
```

**Usage:**
```tsx
<StatusBadge status="wip" label="In Production" />
<StatusBadge status="shipped" label="Shipped" />
```

---

## 18. Empty State Illustrations

Polished empty state when tables have zero results after filtering.

**components/ui/empty-state.tsx:**
```tsx
'use client'

import { SearchX, FilterX, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  type?: 'no-results' | 'no-data' | 'filtered'
  title?: string
  description?: string
  onClearFilters?: () => void
}

export function EmptyState({ type = 'no-results', title, description, onClearFilters }: EmptyStateProps) {
  const defaults = {
    'no-results': { icon: SearchX, title: 'No results found', desc: 'Try adjusting your search or filters.' },
    'no-data': { icon: Inbox, title: 'No data yet', desc: 'Data will appear here once available.' },
    'filtered': { icon: FilterX, title: 'No matches', desc: 'No items match your current filters.' },
  }

  const config = defaults[type]
  const Icon = config.icon

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title || config.title}</h3>
      <p className="text-xs text-muted-foreground max-w-sm mb-4">{description || config.desc}</p>
      {onClearFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear all filters
        </Button>
      )}
    </div>
  )
}
```

**Usage:**
```tsx
{filteredData.length === 0 ? (
  <EmptyState type="filtered" onClearFilters={() => resetFilters()} />
) : (
  <DataTable ... />
)}
```

---

## 19. Command Palette (`⌘K`)

Spotlight-style search to jump to any page, find orders by PO#, or trigger actions.

**Implementation approach:**
- Create `components/ui/command-palette.tsx` using a dialog + input
- Listen for `⌘K` / `Ctrl+K` globally
- Index all nav items + allow searching orders by PO number
- Use framer-motion for the overlay fade + scale animation

**components/ui/command-palette.tsx (skeleton):**
```tsx
'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ArrowRight } from 'lucide-react'

interface CommandItem {
  label: string
  href?: string
  section: string
  icon?: React.ReactNode
  action?: () => void
}

export function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) { inputRef.current?.focus(); setQuery(''); setSelectedIndex(0) }
  }, [open])

  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = (item: CommandItem) => {
    if (item.href) router.push(item.href)
    if (item.action) item.action()
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-x-0 top-[20%] z-[10000] mx-auto w-full max-w-lg"
          >
            <div className="rounded-xl border bg-card shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <Search className="size-4 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
                  placeholder="Search pages, orders, actions..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)) }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
                    if (e.key === 'Enter' && filtered[selectedIndex]) handleSelect(filtered[selectedIndex])
                  }}
                />
                <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">ESC</kbd>
              </div>
              <div className="max-h-72 overflow-y-auto p-2">
                {filtered.map((item, i) => (
                  <button
                    key={item.label}
                    onClick={() => handleSelect(item)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      i === selectedIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {item.icon}
                    <span className="flex-1 text-left">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.section}</span>
                    {i === selectedIndex && <ArrowRight className="size-3" />}
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Usage:** Add `<CommandPalette items={navItems} />` to dashboard layout. Wire in your nav items array.

---

## 20. Contextual Row Color Strips (Status Left-Border)

Subtle left-border color on table rows based on status — scan the whole table at a glance.

**CSS (globals.css):**
```css
.row-status-pending { box-shadow: inset 3px 0 0 0 #d69e2e; }
.row-status-wip { box-shadow: inset 3px 0 0 0 #319795; }
.row-status-completed { box-shadow: inset 3px 0 0 0 #38a169; }
.row-status-staged { box-shadow: inset 3px 0 0 0 #4299e1; }
.row-status-shipped { box-shadow: inset 3px 0 0 0 #a0aec0; }
```

**Usage (on `<tr>`):**
```tsx
className={cn('table-row-hover', `row-status-${normalizeStatus(row.status)}`)}
```

---

## 21. Stat Card Progress Bars

Thin animated progress bar under stat numbers showing completion percentage.

**components/ui/progress-bar.tsx:**
```tsx
'use client'

import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number      // 0–100
  color?: string     // Tailwind bg class
  className?: string
  animated?: boolean
}

export function ProgressBar({ value, color = 'bg-primary', className, animated = true }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div className={cn('h-1.5 w-full rounded-full bg-muted overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-700 ease-out', color)}
        style={{
          width: `${clamped}%`,
          ...(animated ? { animation: 'progress-fill 800ms ease-out' } : {}),
        }}
      />
    </div>
  )
}
```

**CSS:**
```css
@keyframes progress-fill {
  from { width: 0%; }
}
```

**Usage:**
```tsx
<div className="text-2xl font-bold">127 / 350</div>
<ProgressBar value={(127 / 350) * 100} color="bg-emerald-500" />
```

---

## 22. Collapsible Sidebar Sections with Memory

Sidebar nav sections collapse/expand and remember state in localStorage. Already partially implemented via `CollapsibleNavSection` — this enhancement adds smooth height animation + rotate chevron.

**Enhancement to existing CollapsibleNavSection:**
```tsx
// Add framer-motion height animation
<motion.div
  initial={false}
  animate={{ height: isOpen ? 'auto' : 0 }}
  transition={{ duration: 0.2, ease: 'easeInOut' }}
  className="overflow-hidden"
>
  {children}
</motion.div>

// Chevron rotation
<motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
  <ChevronRight className="size-3.5" />
</motion.span>
```

---

## 23. Notification Badge Bounce Animation

Bell icon bounces and count scales up when new notifications arrive.

**CSS (globals.css):**
```css
@keyframes bell-ring {
  0% { transform: rotate(0deg); }
  15% { transform: rotate(14deg); }
  30% { transform: rotate(-12deg); }
  45% { transform: rotate(8deg); }
  60% { transform: rotate(-6deg); }
  75% { transform: rotate(2deg); }
  100% { transform: rotate(0deg); }
}
@keyframes badge-pop {
  0% { transform: scale(0.5); opacity: 0; }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}
.bell-ring { animation: bell-ring 0.6s ease-in-out; }
.badge-pop { animation: badge-pop 0.3s ease-out; }
```

**Usage:** When notification count changes, add `.bell-ring` to the bell icon and `.badge-pop` to the count badge (remove after animation completes).

---

## 24. Data Freshness Indicator

Small pill showing when data was last fetched with a colored dot based on age.

**components/ui/data-freshness.tsx:**
```tsx
'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface DataFreshnessProps {
  lastUpdated: Date | null
  className?: string
}

export function DataFreshness({ lastUpdated, className }: DataFreshnessProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 10000)
    return () => clearInterval(interval)
  }, [])

  if (!lastUpdated) return null

  const diffMs = now.getTime() - lastUpdated.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  const dotColor = diffMin < 1 ? 'bg-green-500' : diffMin < 5 ? 'bg-amber-500' : 'bg-red-500'
  const label = diffMin < 1 ? 'Just now' : `${diffMin}m ago`

  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] text-muted-foreground', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dotColor)} />
      {label}
    </div>
  )
}
```

**Usage:**
```tsx
<DataFreshness lastUpdated={lastFetchTime} />
```

---

## 25. Scroll-to-Top Floating Button

Appears after scrolling 500px. Smooth scroll back to top.

**components/ui/scroll-to-top.tsx:**
```tsx
'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = () => setVisible(window.scrollY > 500)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        'fixed bottom-6 right-6 z-50 rounded-full bg-primary p-2.5 text-primary-foreground shadow-lg',
        'transition-all duration-300',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      )}
      aria-label="Scroll to top"
    >
      <ArrowUp className="size-4" />
    </button>
  )
}
```

**Usage:** Add `<ScrollToTop />` to dashboard layout.

---
---

# Quick Copy Checklist

## Implemented (#1–15)
1. ✅ `npm install framer-motion lenis`
2. ✅ Copy CSS blocks to `globals.css`
3. ✅ Copy component files to `components/ui/`
4. ✅ Copy `lib/use-toast.ts`
5. ✅ Add `<PageTransition>` to dashboard layout
6. ✅ Add `<SmoothScroll>` to dashboard layout
7. ✅ Add `<ToastProvider />` to root layout
8. ✅ Add `stat-card-hover` classes to stat cards
9. ✅ Add `table-row-hover` classes to table rows
10. ✅ Add row stagger styles to `<tr>` elements
11. ✅ Update sidebar nav links with active pill

## Proposed (#16–25)
12. 🔲 Add `<BreadcrumbNav />` to layout
13. 🔲 Replace status badges with `<StatusBadge />`
14. 🔲 Add `<EmptyState />` to filtered tables
15. 🔲 Add `<CommandPalette />` (`⌘K`)
16. 🔲 Add status row color strips to tables
17. 🔲 Add `<ProgressBar />` under stat numbers
18. 🔲 Enhance sidebar collapsible sections
19. 🔲 Add bell notification animation CSS
20. 🔲 Add `<DataFreshness />` indicator
21. 🔲 Add `<ScrollToTop />` button
