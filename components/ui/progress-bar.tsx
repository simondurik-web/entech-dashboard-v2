'use client'

import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number      // 0–100
  color?: string     // Tailwind bg class
  className?: string
  animated?: boolean
}

export function ProgressBar({ value, color = 'bg-primary', className, animated = true }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div className={cn('h-1.5 w-full rounded-full bg-muted overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-700 ease-out', color)}
        style={{
          width: `${clamped}%`,
          ...(animated ? { animation: 'progress-fill 800ms ease-out' } : {}),
        }}
      />
    </div>
  )
}
