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
