'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  // Enter-only fade. The previous version used AnimatePresence mode="wait"
  // with a 250ms exit + 250ms enter — every navigation paid ~half a second
  // of artificial delay before the new page appeared. Perf pass 2026-06-10.
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
