import { useEffect, useRef, useState, useCallback } from 'react'

interface UseAutoRefreshOptions {
  /** Refresh interval in milliseconds (default: 5 minutes) */
  interval?: number
  /** Whether auto-refresh is enabled (default: true) */
  enabled?: boolean
  /** Callback to execute on refresh */
  onRefresh: () => void | Promise<void>
}

export function useAutoRefresh({
  interval = 5 * 60 * 1000, // 5 minutes
  enabled = true,
  onRefresh,
}: UseAutoRefreshOptions) {
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(enabled)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [nextRefresh, setNextRefresh] = useState<Date>(new Date(Date.now() + interval))
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const doRefresh = useCallback(async () => {
    await onRefresh()
    setLastRefresh(new Date())
    setNextRefresh(new Date(Date.now() + interval))
  }, [onRefresh, interval])

  useEffect(() => {
    if (!isAutoRefreshEnabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Set up interval
    intervalRef.current = setInterval(doRefresh, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isAutoRefreshEnabled, interval, doRefresh])

  const toggleAutoRefresh = useCallback(() => {
    setIsAutoRefreshEnabled((prev) => !prev)
  }, [])

  const refreshNow = useCallback(async () => {
    await doRefresh()
  }, [doRefresh])

  return {
    isAutoRefreshEnabled,
    toggleAutoRefresh,
    lastRefresh,
    nextRefresh,
    refreshNow,
  }
}

/** Format time until next refresh */
export function formatTimeUntil(date: Date): string {
  const now = Date.now()
  const diff = date.getTime() - now
  
  if (diff <= 0) return 'now'
  
  const minutes = Math.floor(diff / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}
