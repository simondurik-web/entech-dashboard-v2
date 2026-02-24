'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Bell, BellOff, BellRing, Clock, Zap, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, isPushSupported } from '@/lib/push-notifications'

interface Notification {
  id: string
  title: string
  body: string | null
  targetRole: string | null
  sentCount: number
  createdAt: string
  isAuto: boolean
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export function NotificationBell() {
  const { user } = useAuth()
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [supported, setSupported] = useState(false)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [fetchingNotifs, setFetchingNotifs] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const lastSeenRef = useRef<string | null>(null)

  useEffect(() => {
    setSupported(isPushSupported())
    isPushSubscribed().then(setSubscribed)
    // Load last seen timestamp
    lastSeenRef.current = localStorage.getItem('notifications-last-seen')
  }, [])

  const fetchNotifications = useCallback(async () => {
    try {
      setFetchingNotifs(true)
      const res = await fetch('/api/notifications/my')
      if (res.ok) {
        const data = await res.json()
        const notifs: Notification[] = (data.notifications || []).map((n: Record<string, unknown>) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          targetRole: n.targetRole,
          sentCount: n.sentCount,
          createdAt: n.createdAt,
          isAuto: n.isAuto,
        }))
        setNotifications(notifs)
        // Calculate unread
        const lastSeen = lastSeenRef.current
        if (lastSeen) {
          const lastSeenTime = new Date(lastSeen).getTime()
          const unread = notifs.filter(n => new Date(n.createdAt).getTime() > lastSeenTime).length
          setUnreadCount(unread)
        } else {
          setUnreadCount(notifs.length)
        }
      }
    } catch { /* ignore */ }
    setFetchingNotifs(false)
  }, [])

  // Fetch on mount and every 60 seconds
  useEffect(() => {
    if (!user) return
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60000)
    return () => clearInterval(interval)
  }, [user, fetchNotifications])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Mark as seen when opening
  useEffect(() => {
    if (open && notifications.length > 0) {
      const newest = notifications[0].createdAt
      localStorage.setItem('notifications-last-seen', newest)
      lastSeenRef.current = newest
      setUnreadCount(0)
      // Clear app badge
      if ('clearAppBadge' in navigator) {
        (navigator as unknown as { clearAppBadge: () => void }).clearAppBadge()
      }
    }
  }, [open, notifications])

  if (!supported || !user) return null

  async function toggleSubscription() {
    if (!user) return
    setLoading(true)
    try {
      if (subscribed) {
        await unsubscribeFromPush(user.id)
        setSubscribed(false)
      } else {
        const ok = await subscribeToPush(user.id)
        setSubscribed(ok)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg transition-colors relative text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {subscribed && unreadCount === 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-green-400 rounded-full" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] rounded-xl border border-white/[0.08] bg-popover shadow-2xl z-[200] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <h3 className="font-semibold text-sm">Notifications</h3>
            <div className="flex items-center gap-1">
              {/* Mute/unmute toggle */}
              <button
                onClick={toggleSubscription}
                disabled={loading}
                className={`p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1.5 ${
                  subscribed
                    ? 'text-green-400 hover:bg-green-500/10'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                title={subscribed ? 'Mute notifications' : 'Enable notifications'}
              >
                {loading ? (
                  <BellRing className="size-4 animate-pulse" />
                ) : subscribed ? (
                  <Bell className="size-4" />
                ) : (
                  <BellOff className="size-4" />
                )}
                <span className="hidden sm:inline">{subscribed ? 'On' : 'Off'}</span>
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto flex-1">
            {fetchingNotifs && notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div className="size-6 mx-auto animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="size-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              <div>
                {notifications.map((n) => {
                  const isNew = lastSeenRef.current
                    ? new Date(n.createdAt).getTime() > new Date(lastSeenRef.current).getTime()
                    : true
                  return (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${
                        isNew ? 'bg-primary/[0.03]' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`rounded-md p-1.5 flex-shrink-0 mt-0.5 ${
                          n.isAuto
                            ? n.title.includes('URGENT') ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                            : 'bg-primary/10 text-primary'
                        }`}>
                          {n.isAuto ? <Zap className="size-3.5" /> : <Bell className="size-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-sm truncate">{n.title}</p>
                            {n.isAuto && (
                              <span className="inline-flex px-1 py-0.5 rounded text-[9px] font-medium bg-amber-500/15 text-amber-400 flex-shrink-0">
                                AUTO
                              </span>
                            )}
                          </div>
                          {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/60">
                            <span className="flex items-center gap-0.5">
                              <Clock className="size-3" />
                              {timeAgo(n.createdAt)}
                            </span>
                            {n.sentCount > 0 && <span>· {n.sentCount} delivered</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
