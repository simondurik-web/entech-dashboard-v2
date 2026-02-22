"use client"

import { useState, useEffect, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

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
  const [isOpen, setIsOpen] = useState(defaultOpen)

  useEffect(() => {
    const stored = localStorage.getItem(`nav-section-${storageKey}`)
    if (stored !== null) setIsOpen(stored === "true")
  }, [storageKey])

  const toggle = () => {
    const next = !isOpen
    setIsOpen(next)
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
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-200",
              !isOpen && "-rotate-90"
            )}
          />
        )}
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          isOpen || !expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        {children}
      </div>
    </div>
  )
}
