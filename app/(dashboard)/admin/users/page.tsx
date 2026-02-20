'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth, type UserRole, SUPER_ADMIN_EMAIL } from '@/lib/auth-context'
import { Search, ChevronDown, ChevronRight, UserPlus, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface UserRecord {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole
  custom_permissions: string[] | null
  is_active: boolean
  last_login: string | null
  created_at: string
}

const ROLES: UserRole[] = ['visitor', 'regular_user', 'group_leader', 'manager', 'admin']

const ALL_MENU_PATHS = [
  '/orders', '/need-to-make', '/need-to-package', '/staged', '/shipped',
  '/inventory', '/inventory-history', '/drawings', '/pallet-records',
  '/shipping-records', '/fp-reference', '/staged-records',
  '/sales-overview', '/sales-parts', '/sales-customers', '/sales-dates',
  '/customer-reference', '/quotes',
  '/bom', '/material-requirements', '/all-data',
  '/admin/users', '/admin/permissions',
  '/phil-assistant',
  'manage_priority',
]

export default function AdminUsersPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollEmail, setEnrollEmail] = useState('')
  const [enrollRole, setEnrollRole] = useState<UserRole>('regular_user')
  const [enrollStatus, setEnrollStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const { t } = useI18n()

  const fetchUsers = useCallback(async () => {
    if (!user) return
    const res = await fetch('/api/admin/users', {
      headers: { 'x-user-id': user.id },
    })
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users ?? [])
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const updateUser = async (userId: string, updates: Partial<UserRecord>) => {
    if (!user) return
    setSaving(userId)
    await fetch('/api/admin/users', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.id,
      },
      body: JSON.stringify({ user_id: userId, ...updates }),
    })
    await fetchUsers()
    setSaving(null)
  }

  const toggleCustomPermission = (u: UserRecord, path: string) => {
    const current = u.custom_permissions ?? []
    const next = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path]
    updateUser(u.id, { custom_permissions: next.length > 0 ? next : null })
  }

  const preEnrollUser = async () => {
    if (!user || !enrollEmail) return
    setEnrolling(true)
    setEnrollStatus(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ email: enrollEmail, role: enrollRole }),
      })
      if (res.ok) {
        setEnrollStatus({ type: 'success', message: `Pre-enrolled ${enrollEmail}` })
        setEnrollEmail('')
        setEnrollRole('regular_user')
        await fetchUsers()
        setTimeout(() => {
          setShowEnroll(false)
          setEnrollStatus(null)
        }, 1500)
      } else {
        const data = await res.json()
        setEnrollStatus({ type: 'error', message: data.error || 'Failed to pre-enroll' })
      }
    } catch {
      setEnrollStatus({ type: 'error', message: 'Network error' })
    }
    setEnrolling(false)
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    return (
      (u.full_name?.toLowerCase().includes(q) ?? false) ||
      u.email.toLowerCase().includes(q)
    )
  })

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('page.adminUsers')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('page.adminUsersSubtitle')} ({users.length} {t('admin.users')})
          </p>
        </div>
        <button
          onClick={() => { setShowEnroll(!showEnroll); setEnrollStatus(null) }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <UserPlus className="size-4" />
          {t('admin.preEnroll')}
        </button>
      </div>

      {showEnroll && (
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Pre-enroll New User</h3>
            <button onClick={() => { setShowEnroll(false); setEnrollStatus(null) }} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Email</label>
              <input
                type="email"
                placeholder={t('admin.emailPlaceholder')}
                value={enrollEmail}
                onChange={(e) => setEnrollEmail(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Role</label>
              <select
                value={enrollRole}
                onChange={(e) => setEnrollRole(e.target.value as UserRole)}
                className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <button
              onClick={preEnrollUser}
              disabled={enrolling || !enrollEmail}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {enrolling ? t('admin.adding') : t('ui.add')}
            </button>
          </div>
          {enrollStatus && (
            <p className={`mt-2 text-sm ${enrollStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
              {enrollStatus.message}
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('ui.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Users table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">{t('table.user')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.email')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.role')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.status')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('table.lastLogin')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <>
                <tr key={u.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                      className="flex items-center gap-2"
                    >
                      {expandedUser === u.id ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                      {u.avatar_url ? (
                        <img
                          src={u.avatar_url}
                          alt=""
                          className="size-7 rounded-full"
                        />
                      ) : (
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {(u.full_name?.[0] ?? u.email[0]).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium">
                        {u.full_name || t('admin.noName')}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        🔒 {t('admin.superAdmin')}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) =>
                          updateUser(u.id, { role: e.target.value as UserRole })
                        }
                        disabled={saving === u.id}
                        className="rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                      disabled={saving === u.id}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        u.is_active
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {u.is_active ? t('admin.active') : t('admin.inactive')}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.last_login
                      ? new Date(u.last_login).toLocaleDateString()
                      : t('admin.never')}
                  </td>
                </tr>
                {expandedUser === u.id && (
                  <tr key={`${u.id}-perms`} className="border-b bg-muted/20">
                    <td colSpan={5} className="px-8 py-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Custom Permissions (overrides role)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ALL_MENU_PATHS.map((path) => {
                          const checked = u.custom_permissions?.includes(path) ?? false
                          return (
                            <label
                              key={path}
                              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                                checked
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border text-muted-foreground hover:bg-muted'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCustomPermission(u, path)}
                                className="sr-only"
                              />
                              {path}
                            </label>
                          )
                        })}
                      </div>
                      {u.custom_permissions && u.custom_permissions.length > 0 && (
                        <button
                          onClick={() => updateUser(u.id, { custom_permissions: null })}
                          className="mt-2 text-xs text-destructive hover:underline"
                        >
                          Clear custom permissions (use role defaults)
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
