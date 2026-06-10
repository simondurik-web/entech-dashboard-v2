'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { userHeaders } from '@/lib/quality/form-utils'
import AdminPanel from './AdminPanel'
import AuditTrail from './AuditTrail'
import NotificationsPanel from './NotificationsPanel'
import type { AppUser } from '@/lib/pallets/types'

type Tab = 'users' | 'audit' | 'notifications'

export default function AdminPage() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('users')

  useEffect(() => {
    const loadAdmin = async () => {
      if (!profile?.id) return

      setCurrentUserId(profile.id)

      const res = await fetch('/api/pallet-records/users', { headers: userHeaders(profile.id) })
      
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users || [])
      }
      
      setLoading(false)
    }

    loadAdmin()
  }, [profile?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-sky-600 dark:border-sky-400 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border bg-card sticky top-0 z-10">
        <button
          onClick={() => setTab('users')}
          className={`flex-1 py-3 text-center text-sm font-semibold transition-colors ${
            tab === 'users'
              ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400'
              : 'text-muted-foreground hover:text-muted-foreground'
          }`}
        >
          👥 Users
        </button>
        <button
          onClick={() => setTab('audit')}
          className={`flex-1 py-3 text-center text-sm font-semibold transition-colors ${
            tab === 'audit'
              ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400'
              : 'text-muted-foreground hover:text-muted-foreground'
          }`}
        >
          📋 Audit
        </button>
        <button
          onClick={() => setTab('notifications')}
          className={`flex-1 py-3 text-center text-sm font-semibold transition-colors ${
            tab === 'notifications'
              ? 'text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400'
              : 'text-muted-foreground hover:text-muted-foreground'
          }`}
        >
          🔔 Notify
        </button>
      </div>

      {tab === 'users' && <AdminPanel users={users} currentUserId={currentUserId} />}
      {tab === 'audit' && <AuditTrail />}
      {tab === 'notifications' && <NotificationsPanel />}
    </div>
  )
}
