'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, Zap, User, Users, Clock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Notification {
  id: string
  title: string
  body: string | null
  sentBy: string | null
  targetRole: string | null
  targetUserId: string | null
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/my')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  // Clear badge when visiting this page
  useEffect(() => {
    if ('clearAppBadge' in navigator) {
      (navigator as unknown as { clearAppBadge: () => void }).clearAppBadge()
    }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="size-6" /> Notifications
          </h1>
          <p className="text-sm text-muted-foreground">Recent alerts and updates</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchNotifications}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <Bell className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No notifications yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">You&apos;ll see alerts here when orders change status</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2 flex-shrink-0 ${
                  n.isAuto
                    ? n.title.includes('URGENT') ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                    : 'bg-primary/10 text-primary'
                }`}>
                  {n.isAuto ? <Zap className="size-4" /> : <Bell className="size-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{n.title}</p>
                    {n.isAuto && (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        AUTO
                      </span>
                    )}
                  </div>
                  {n.body && <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/70">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {timeAgo(n.createdAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      {n.targetUserId ? <User className="size-3" /> : <Users className="size-3" />}
                      {n.targetUserId ? 'Direct' : n.isAuto ? 'Automatic' : 'All users'}
                    </span>
                    {n.sentCount > 0 && <span>{n.sentCount} delivered</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
