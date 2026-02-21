"use client"

import { useState, useEffect } from "react"

export function useCountUp(target: number, duration = 1000) {
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
        setValue(Math.floor(target * (elapsed / duration)))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])

  return value
}
