'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, Clock, Pause, Play } from 'lucide-react'
import { formatTimeUntil } from '@/lib/use-auto-refresh'

interface AutoRefreshControlProps {
  isEnabled: boolean
  onToggle: () => void
  onRefreshNow: () => void
  isRefreshing: boolean
  nextRefresh: Date
  lastRefresh: Date
}

export function AutoRefreshControl({
  isEnabled,
  onToggle,
  onRefreshNow,
  isRefreshing,
  nextRefresh,
  lastRefresh,
}: AutoRefreshControlProps) {
  const [timeUntil, setTimeUntil] = useState(formatTimeUntil(nextRefresh))

  // Update countdown every second
  useEffect(() => {
    if (!isEnabled) return
    
    const timer = setInterval(() => {
      setTimeUntil(formatTimeUntil(nextRefresh))
    }, 1000)

    return () => clearInterval(timer)
  }, [isEnabled, nextRefresh])

  return (
    <div className="flex items-center gap-2">
      {/* Auto-refresh toggle */}
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
          isEnabled
            ? 'bg-green-500/20 text-green-600 dark:text-green-400'
            : 'bg-muted text-muted-foreground'
        }`}
        title={isEnabled ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
      >
        {isEnabled ? <Play className="size-3" /> : <Pause className="size-3" />}
        <span className="hidden sm:inline">Auto</span>
        {isEnabled && (
          <span className="flex items-center gap-1 text-[10px] opacity-70">
            <Clock className="size-2.5" />
            {timeUntil}
          </span>
        )}
      </button>

      {/* Manual refresh button */}
      <button
        onClick={onRefreshNow}
        disabled={isRefreshing}
        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
        aria-label="Refresh now"
        title={`Last refresh: ${lastRefresh.toLocaleTimeString()}`}
      >
        <RefreshCw className={`size-5 ${isRefreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}
