'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n'

export function CurrentTime() {
  const { t } = useI18n()
  const [time, setTime] = useState<string>('')

  useEffect(() => {
    const fmt = () => {
      const now = new Date()
      return now.toLocaleTimeString('en-US', {
        timeZone: 'America/Indiana/Indianapolis',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    }
    setTime(fmt())
    const interval = setInterval(() => setTime(fmt()), 60_000)
    return () => clearInterval(interval)
  }, [])

  if (!time) return null

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="text-muted-foreground">{t('scheduling.currentTime')}:</span>
      <span className="font-mono font-medium text-foreground">{time}</span>
    </div>
  )
}
