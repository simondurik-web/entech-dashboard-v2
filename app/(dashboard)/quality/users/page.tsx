"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search, Shield, Trash2, UserPlus, Users, Eye, Wrench, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { userHeaders } from "@/lib/quality/form-utils"

type UserRecord = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  dashboard_role: string
  custom_permissions: string[] | null
  is_active: boolean
  last_login: string | null
  created_at: string
}

const ROLES = ["visitor", "operator", "group_leader", "qa_manager", "manager", "admin"] as const
const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const QA_PERMISSIONS = ["/quality/hubs", "/quality/hubs/new", "/quality/tires", "/quality/tires/new", "/quality/finished", "/quality/finished/new", "/quality/products", "/quality/limits", "/quality/audit", "/quality/users"]

const ROLE_ICONS: Record<string, typeof Shield> = {
  admin: Shield,
  qa_manager: Shield,
  manager: Users,
  group_leader: Users,
  operator: Wrench,
  visitor: Eye,
}

export default function QualityUsersPage() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canManageQuality } = useQualityAccess()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollEmail, setEnrollEmail] = useState("")
  const [enrollName, setEnrollName] = useState("")
  const [enrollRole, setEnrollRole] = useState("operator")
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<UserRecord | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    if (!canManageQuality) return
    setLoading(true)
    try {
      const res = await fetch("/api/quality/users", { headers: { "x-user-id": profile?.id || "" } })
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users || [])
      }
    } finally {
      setLoading(false)
    }
  }, [canManageQuality, profile?.id])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter((u) => (u.full_name?.toLowerCase().includes(q) ?? false) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q))
  }, [users, search])

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const user of users) counts[user.role] = (counts[user.role] || 0) + 1
    return counts
  }, [users])

  if (!canManageQuality) return null

  async function updateUser(userId: string, updates: Partial<UserRecord>) {
    setSaving(userId)
    await fetch("/api/quality/users", {
      method: "PUT",
      headers: userHeaders(profile?.id),
      body: JSON.stringify({ user_id: userId, ...updates }),
    })
    await fetchUsers()
    setSaving(null)
  }

  async function enrollUser() {
    if (!enrollEmail.trim()) return
    setSaving("enroll")
    setEnrollStatus(null)
    try {
      const res = await fetch("/api/quality/users", {
        method: "POST",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({ email: enrollEmail, full_name: enrollName || null, role: enrollRole }),
      })
      if (res.ok) {
        setEnrollStatus(t("quality.admin.enrolled"))
        setEnrollEmail("")
        setEnrollName("")
        setEnrollRole("operator")
        await fetchUsers()
        setTimeout(() => { setShowEnroll(false); setEnrollStatus(null) }, 1200)
      } else {
        const data = await res.json().catch(() => ({}))
        setEnrollStatus(data.error || t("quality.form.networkError"))
      }
    } finally {
      setSaving(null)
    }
  }

  async function removeQualityUser() {
    if (!confirmDelete) return
    setSaving(confirmDelete.id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/quality/users?user_id=${encodeURIComponent(confirmDelete.id)}`, {
        method: "DELETE",
        headers: { "x-user-id": profile?.id || "" },
      })
      if (res.ok) {
        setConfirmDelete(null)
        setExpandedUser(null)
        await fetchUsers()
      } else {
        const data = await res.json().catch(() => ({}))
        setDeleteError(data.error || t("quality.admin.deleteFailed"))
      }
    } finally {
      setSaving(null)
    }
  }

  function togglePerm(user: UserRecord, path: string) {
    const current = user.custom_permissions ?? []
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path]
    updateUser(user.id, { custom_permissions: next.length ? next : null })
  }

  return (
    <div className="p-4 pb-20">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.qualityUsers")}</h1>
          <p className="text-sm text-muted-foreground">{users.length} {t("quality.admin.registeredUsers")}</p>
        </div>
        <Button onClick={() => { setShowEnroll((v) => !v); setEnrollStatus(null) }}><UserPlus className="mr-2 size-4" />{t("quality.admin.addUser")}</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {ROLES.map((role) => {
          const Icon = ROLE_ICONS[role]
          return (
            <Card key={role} className="border-border bg-card">
              <CardContent className="p-3">
                <div className="mb-1 flex items-center gap-2"><Icon className="size-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">{t(`quality.role.${role}`)}</span></div>
                <span className="text-xl font-bold">{roleCounts[role] || 0}</span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {showEnroll && (
        <Card className="mb-4 border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t("quality.admin.enrollUser")}</CardTitle>
              <button onClick={() => setShowEnroll(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1"><label className="mb-1 block text-xs text-muted-foreground">{t("quality.admin.email")}</label><Input value={enrollEmail} onChange={(e) => setEnrollEmail(e.target.value)} placeholder="user@email.com" /></div>
              <div className="flex-1"><label className="mb-1 block text-xs text-muted-foreground">{t("quality.admin.name")}</label><Input value={enrollName} onChange={(e) => setEnrollName(e.target.value)} placeholder={t("quality.admin.fullName")} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">{t("quality.admin.role")}</label><Select value={enrollRole} onValueChange={setEnrollRole}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{t(`quality.role.${role}`)}</SelectItem>)}</SelectContent></Select></div>
              <Button onClick={enrollUser} disabled={saving === "enroll" || !enrollEmail}>{saving === "enroll" ? "..." : t("quality.admin.add")}</Button>
            </div>
            {enrollStatus && <p className="mt-2 text-sm text-muted-foreground">{enrollStatus}</p>}
          </CardContent>
        </Card>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("quality.admin.search")} className="pl-10" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">{t("quality.admin.loading")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("quality.admin.user")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("quality.admin.email")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("quality.admin.role")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("quality.admin.status")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("quality.admin.lastLogin")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const isSuper = user.email?.toLowerCase() === SUPER_ADMIN_EMAIL
                const isSelf = user.id === profile?.id
                return (
                  <Fragment key={user.id}>
                    <tr className="border-b border-border/70 hover:bg-muted/35">
                      <td className="px-4 py-3">
                        <button onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)} className="flex items-center gap-2">
                          {expandedUser === user.id ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                          <span className="font-medium">{user.full_name || t("quality.admin.noName")}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-3">
                        {isSuper ? (
                          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">{t("quality.admin.superAdmin")}</Badge>
                        ) : (
                          <Select value={user.role} disabled={saving === user.id || isSelf} onValueChange={(role) => updateUser(user.id, { role })}>
                            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{t(`quality.role.${role}`)}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => updateUser(user.id, { is_active: !user.is_active })}
                          disabled={saving === user.id || isSuper || isSelf}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${user.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}
                        >
                          {user.is_active ? t("quality.admin.active") : t("quality.admin.inactive")}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{user.last_login ? new Date(user.last_login).toLocaleDateString() : t("quality.admin.never")}</td>
                    </tr>
                    {expandedUser === user.id && (
                      <tr className="border-b border-border/70 bg-muted/20">
                        <td colSpan={5} className="px-8 py-4">
                          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t("quality.admin.customPermissions")}</p>
                          <div className="flex flex-wrap gap-2">
                            {QA_PERMISSIONS.map((path) => {
                              const checked = user.custom_permissions?.includes(path) ?? false
                              return (
                                <label key={path} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${checked ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400" : "border-border text-muted-foreground hover:bg-muted"}`}>
                                  <input type="checkbox" checked={checked} onChange={() => togglePerm(user, path)} className="sr-only" />
                                  {path}
                                </label>
                              )
                            })}
                          </div>
                          {!isSuper && !isSelf && (
                            <button onClick={() => { setDeleteError(null); setConfirmDelete(user) }} className="mt-4 flex items-center gap-1.5 border-t border-border pt-4 text-xs text-red-600 hover:text-red-500 dark:text-red-400">
                              <Trash2 className="size-3.5" />{t("quality.admin.removeQualityUser")}
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) { setConfirmDelete(null); setDeleteError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("quality.admin.removeQualityUser")}</DialogTitle>
            <DialogDescription>{t("quality.admin.removeQualityUserDescription")}</DialogDescription>
          </DialogHeader>
          {confirmDelete && <div className="rounded-lg border border-border bg-muted/30 px-4 py-3"><p className="text-sm font-medium">{confirmDelete.full_name || t("quality.admin.noName")}</p><p className="text-xs text-muted-foreground">{confirmDelete.email}</p></div>}
          {deleteError && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={!!saving}>{t("quality.admin.cancel")}</Button>
            <Button onClick={removeQualityUser} disabled={!!saving} className="bg-red-600 text-white hover:bg-red-700">{saving ? t("quality.admin.saving") : t("quality.admin.remove")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
