'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Listen to both window scroll and Lenis scroll events
    const handler = () => setVisible(window.scrollY > 500)
    window.addEventListener('scroll', handler, { passive: true })

    // Also poll scrollY to catch Lenis smooth scroll updates
    let raf: number
    const poll = () => {
      setVisible(window.scrollY > 500)
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)

    return () => {
      window.removeEventListener('scroll', handler)
      cancelAnimationFrame(raf)
    }
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
