'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, isPushSupported } from '@/lib/push-notifications'

export function NotificationBell() {
  const { user } = useAuth()
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [supported, setSupported] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    setSupported(isPushSupported())
    isPushSubscribed().then(setSubscribed)
  }, [])

  if (!supported || !user) return null

  async function toggle() {
    if (!user) return
    setLoading(true)
    try {
      if (subscribed) {
        await unsubscribeFromPush(user.id)
        setSubscribed(false)
      } else {
        const ok = await subscribeToPush(user.id)
        setSubscribed(ok)
        if (!ok) {
          setShowTooltip(true)
          setTimeout(() => setShowTooltip(false), 3000)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        disabled={loading}
        className={`p-2 rounded-lg transition-colors relative ${
          subscribed
            ? 'text-primary hover:bg-primary/10'
            : 'text-muted-foreground hover:bg-muted'
        }`}
        title={subscribed ? 'Notifications enabled — click to disable' : 'Enable notifications'}
      >
        {loading ? (
          <BellRing className="size-5 animate-pulse" />
        ) : subscribed ? (
          <Bell className="size-5" />
        ) : (
          <BellOff className="size-5" />
        )}
        {subscribed && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-400 rounded-full" />
        )}
      </button>
      {showTooltip && (
        <div className="absolute right-0 top-full mt-1 px-3 py-1.5 bg-destructive text-destructive-foreground text-xs rounded-lg whitespace-nowrap z-50">
          Permission denied — check browser settings
        </div>
      )}
    </div>
  )
}
