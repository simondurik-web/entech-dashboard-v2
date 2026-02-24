"use client"

import { useEffect, useRef, useState } from "react"

interface AnimatedNumberProps {
  value: string          // formatted string like "$12,345" or "1,200"
  duration?: number      // ms, default 600
  className?: string
}

/**
 * Animates a number from 0 to target value on mount/change.
 * Handles currency ($), percentages (%), commas, and decimals.
 */
export function AnimatedNumber({ value, duration = 600, className }: AnimatedNumberProps) {
  const [display, setDisplay] = useState("0")
  const prevValue = useRef("0")
  const isFirstRender = useRef(true)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    // Parse the numeric part
    const prefix = value.match(/^[^0-9.-]*/)?.[0] || ""
    const suffix = value.match(/[^0-9.,]*$/)?.[0] || ""
    const numStr = value.replace(/[^0-9.-]/g, "")
    const target = parseFloat(numStr)

    if (isNaN(target)) {
      setDisplay(value)
      return
    }

    // Parse previous value for smooth transitions
    const prevNumStr = prevValue.current.replace(/[^0-9.-]/g, "")
    const from = parseFloat(prevNumStr) || 0
    prevValue.current = value

    const decimals = numStr.includes(".") ? numStr.split(".")[1]?.length || 0 : 0
    const hasCommas = value.includes(",")

    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)

      const current = from + (target - from) * eased
      let formatted = decimals > 0 ? current.toFixed(decimals) : Math.round(current).toString()

      if (hasCommas) {
        const parts = formatted.split(".")
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
        formatted = parts.join(".")
      }

      setDisplay(`${prefix}${formatted}${suffix}`)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  // Respect reduced motion
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return <span className={className}>{value}</span>
  }

  return <span className={className}>{display}</span>
}
