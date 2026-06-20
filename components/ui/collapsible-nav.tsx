"use client"

import { useState, useEffect, useContext, createContext, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

// --- Accordion coordination ---------------------------------------------
// When sections are wrapped in <NavAccordionProvider>, only ONE section is
// open at a time (Option A from the menu redesign). Opening a section closes
// the others. The active page's section auto-opens. Without the provider,
// each CollapsibleNavSection falls back to its old independent localStorage
// behavior, so the mobile menu / any other usage is unaffected.
interface NavAccordionContextValue {
  openKey: string | null
  setOpenKey: (key: string | null) => void
}

const NavAccordionContext = createContext<NavAccordionContextValue | null>(null)

const ACCORDION_STORAGE_KEY = "nav-accordion-open"

export function NavAccordionProvider({
  activeKey,
  children,
}: {
  // storageKey of the section containing the current page (auto-opens it).
  activeKey?: string | null
  children: ReactNode
}) {
  const [openKey, setOpenKeyState] = useState<string | null>(activeKey ?? null)

  // On first mount (and whenever the active section changes due to
  // navigation) prefer the active section. Fall back to the last section the
  // user manually opened if the current page isn't inside any section.
  useEffect(() => {
    if (activeKey) {
      setOpenKeyState(activeKey)
      return
    }
    const stored = localStorage.getItem(ACCORDION_STORAGE_KEY)
    if (stored !== null) setOpenKeyState(stored || null)
  }, [activeKey])

  const setOpenKey = (key: string | null) => {
    setOpenKeyState(key)
    localStorage.setItem(ACCORDION_STORAGE_KEY, key ?? "")
  }

  return (
    <NavAccordionContext.Provider value={{ openKey, setOpenKey }}>
      {children}
    </NavAccordionContext.Provider>
  )
}

interface CollapsibleNavSectionProps {
  label: string
  collapsedLabel?: string
  expanded: boolean // sidebar expanded
  children: ReactNode
  storageKey: string
  defaultOpen?: boolean
}

export function CollapsibleNavSection({
  label,
  collapsedLabel = "•••",
  expanded,
  children,
  storageKey,
  defaultOpen = true,
}: CollapsibleNavSectionProps) {
  const accordion = useContext(NavAccordionContext)
  const [isOpenLocal, setIsOpenLocal] = useState(defaultOpen)

  // Independent (non-accordion) mode: hydrate this section's own state.
  useEffect(() => {
    if (accordion) return
    const stored = localStorage.getItem(`nav-section-${storageKey}`)
    if (stored !== null) setIsOpenLocal(stored === "true")
  }, [storageKey, accordion])

  const isOpen = accordion ? accordion.openKey === storageKey : isOpenLocal

  const toggle = () => {
    if (accordion) {
      // Clicking the open section closes it; clicking another opens it
      // (and closes whatever was open).
      accordion.setOpenKey(isOpen ? null : storageKey)
      return
    }
    const next = !isOpenLocal
    setIsOpenLocal(next)
    localStorage.setItem(`nav-section-${storageKey}`, String(next))
  }

  return (
    <div>
      <button
        onClick={expanded ? toggle : undefined}
        className={cn(
          "mb-1 w-full flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50 transition-all duration-300 whitespace-nowrap",
          !expanded && "text-center text-[8px] tracking-normal justify-center",
          expanded && "hover:text-white/70 cursor-pointer"
        )}
      >
        <span>{expanded ? label : collapsedLabel}</span>
        {expanded && (
          <motion.span
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ duration: 0.15 }}
          >
            <ChevronRight className="size-3" />
          </motion.span>
        )}
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen || !expanded ? 'auto' : 0 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="overflow-hidden"
      >
        {children}
      </motion.div>
    </div>
  )
}
