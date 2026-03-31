'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      // Allow elements with data-lenis-prevent to handle their own scroll
      prevent: (node: Element) => node.hasAttribute('data-lenis-prevent'),
    })
    const raf = (time: number) => {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)

    // Pause Lenis when any Radix dialog opens (body gets data-scroll-locked)
    const observer = new MutationObserver(() => {
      const locked = document.body.hasAttribute('data-scroll-locked')
      if (locked) {
        lenis.stop()
      } else {
        lenis.start()
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked'] })

    return () => {
      observer.disconnect()
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
