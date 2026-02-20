'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Save, Check } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { clearPermissionsCache } from '@/lib/use-permissions'

interface RolePermission {
  id: string
  role: string
  label: string
  description: string
  menu_access: string[]
  sort_order: number
}

const ALL_MENU_PATHS = [
  '/orders', '/need-to-make', '/need-to-package', '/staged', '/shipped',
  '/inventory', '/inventory-history', '/drawings', '/pallet-records',
  '/shipping-records', '/fp-reference', '/staged-records',
  '/sales-overview', '/sales-parts', '/sales-customers', '/sales-dates',
  '/customer-reference', '/quotes',
  '/bom', '/material-requirements', '/all-data',
  '/admin/users', '/admin/permissions',
  '/phil-assistant',
  // Feature permissions (not page paths)
  'manage_priority',
]

const PATH_LABELS: Record<string, string> = {
  '/orders': 'Orders',
  '/need-to-make': 'Need to Make',
  '/need-to-package': 'Need to Package',
  '/staged': 'Staged',
  '/shipped': 'Shipped',
  '/inventory': 'Inventory',
  '/inventory-history': 'Inv. History',
  '/drawings': 'Drawings',
  '/pallet-records': 'Pallet Records',
  '/shipping-records': 'Shipping Records',
  '/fp-reference': 'FP Reference',
  '/staged-records': 'Staged Records',
  '/sales-overview': 'Sales Overview',
  '/sales-parts': 'Sales by Part',
  '/sales-customers': 'Sales by Customer',
  '/sales-dates': 'Sales by Date',
  '/customer-reference': 'Customer Ref',
  '/quotes': 'Quotes',
  '/bom': 'BOM',
  '/material-requirements': 'Material Reqs',
  '/all-data': 'All Data',
  '/admin/users': 'Admin: Users',
  '/admin/permissions': 'Admin: Permissions',
  '/phil-assistant': '🤖 Phil Assistant (AI)',
  'manage_priority': '🎯 Manage Priority',
}

export default function AdminPermissionsPage() {
  const { user } = useAuth()
  const [roles, setRoles] = useState<RolePermission[]>([])
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const { t } = useI18n()

  const fetchData = useCallback(async () => {
    const [permRes, usersRes] = await Promise.all([
      fetch('/api/admin/permissions'),
      user
        ? fetch('/api/admin/users', { headers: { 'x-user-id': user.id } })
        : Promise.resolve(null),
    ])

    if (permRes.ok) {
      const data = await permRes.json()
      setRoles(data.roles ?? [])
      const d: Record<string, string[]> = {}
      for (const r of data.roles ?? []) {
        d[r.role] = [...r.menu_access]
      }
      setDraft(d)
    }

    if (usersRes?.ok) {
      const data = await usersRes.json()
      setUserCounts(data.roleCounts ?? {})
    }

    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const toggleAccess = (role: string, path: string) => {
    setDraft((prev) => {
      const current = prev[role] ?? []
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path]
      return { ...prev, [role]: next }
    })
    setSaved(false)
  }

  const saveAll = async () => {
    if (!user) return
    setSaving(true)

    for (const role of roles) {
      if (JSON.stringify(draft[role.role]) !== JSON.stringify(role.menu_access)) {
        await fetch('/api/admin/permissions', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id,
          },
          body: JSON.stringify({
            role: role.role,
            menu_access: draft[role.role],
          }),
        })
      }
    }

    clearPermissionsCache()
    await fetchData()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('page.adminPermissions')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('page.adminPermissionsSubtitle')}
          </p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saved ? (
            <>
              <Check className="size-4" />
              {t('ui.saved')}
            </>
          ) : (
            <>
              <Save className="size-4" />
              {saving ? t('ui.saving') : t('ui.saveChanges')}
            </>
          )}
        </button>
      </div>

      {/* Permissions matrix */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left font-medium">
                {t('admin.page')}
              </th>
              {roles.map((r) => (
                <th key={r.role} className="px-3 py-3 text-center font-medium">
                  <div>{r.label}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {userCounts[r.role] ?? 0} {t('admin.users')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_MENU_PATHS.map((path) => (
              <tr key={path} className="border-b hover:bg-muted/30">
                <td className="sticky left-0 z-10 bg-background px-4 py-2 font-medium">
                  {PATH_LABELS[path] ?? path}
                </td>
                {roles.map((r) => {
                  const checked = draft[r.role]?.includes(path) ?? false
                  return (
                    <td key={r.role} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAccess(r.role, path)}
                        className="size-4 cursor-pointer rounded border-gray-300 text-primary accent-primary"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
