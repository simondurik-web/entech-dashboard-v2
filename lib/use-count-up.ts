"use client"

import { useState, useEffect } from "react"

export function useCountUp(target: number, duration = 3000) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (target === 0) { setValue(0); return }
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        setValue(target)
        clearInterval(timer)
      } else {
        // Ease-out cubic for smoother animation
        const progress = elapsed / duration
        const eased = 1 - Math.pow(1 - progress, 3)
        setValue(Math.floor(target * eased))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])

  return value
}

export function useCountUpDecimal(target: number, decimals = 2, duration = 3000) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (target === 0) { setValue(0); return }
    const start = Date.now()
    const factor = Math.pow(10, decimals)
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        setValue(target)
        clearInterval(timer)
      } else {
        const progress = elapsed / duration
        const eased = 1 - Math.pow(1 - progress, 3)
        setValue(Math.round(target * eased * factor) / factor)
      }
    }, 16)
    return () => clearInterval(timer)
  }, [target, decimals, duration])

  return value
}
