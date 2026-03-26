'use client'

import { cn } from '@/lib/utils'

const statusConfig: Record<string, { bg: string; text: string; dot: string; animate: boolean }> = {
  pending:   { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', animate: true },
  wip:       { bg: 'bg-teal-100 dark:bg-teal-500/20', text: 'text-teal-700 dark:text-teal-400', dot: 'bg-teal-500', animate: true },
  completed: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', animate: false },
  staged:    { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500', animate: false },
  shipped:   { bg: 'bg-gray-100 dark:bg-gray-500/20', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-400', animate: false },
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const config = statusConfig[status.toLowerCase()] || statusConfig.pending

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', config.bg, config.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot, config.animate && 'animate-pulse')} />
      {label}
    </span>
  )
}
