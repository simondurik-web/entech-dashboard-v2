"use client"

import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"

interface PageTransitionProps {
  children: ReactNode
}

/**
 * Wraps page content with a fade+slide transition on route changes.
 * Uses CSS transitions — no animation library needed.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname()
  const [displayChildren, setDisplayChildren] = useState(children)
  const [transitionStage, setTransitionStage] = useState<"enter" | "exit">("enter")

  useEffect(() => {
    // On path change, trigger exit → swap → enter
    setTransitionStage("exit")
    const timeout = setTimeout(() => {
      setDisplayChildren(children)
      setTransitionStage("enter")
      // Scroll to top on page change
      window.scrollTo({ top: 0, behavior: "instant" })
    }, 150) // match exit duration

    return () => clearTimeout(timeout)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // On initial mount and when children update without path change
  useEffect(() => {
    setDisplayChildren(children)
  }, [children])

  return (
    <div
      style={{
        opacity: transitionStage === "enter" ? 1 : 0,
        transform: transitionStage === "enter" ? "translateY(0)" : "translateY(6px)",
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
      }}
    >
      {displayChildren}
    </div>
  )
}
