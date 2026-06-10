'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { userHeaders } from '@/lib/quality/form-utils'
import type { AppUser, UserRole, UserStatus } from '@/lib/pallets/types'

const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'

interface AdminPanelProps {
  users: AppUser[]
  currentUserId: string
}

export default function AdminPanel({ users: initialUsers, currentUserId }: AdminPanelProps) {
  const { profile } = useAuth()
  const [users, setUsers] = useState(initialUsers)
  const [loading, setLoading] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [addingUser, setAddingUser] = useState(false)
  const [addError, setAddError] = useState('')

  const updateUser = async (userId: string, updates: { role?: UserRole; status?: UserStatus; name?: string }) => {
    // Block changes to super admin
    const targetUser = users.find(u => u.id === userId)
    if (targetUser?.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
      return // Can't change super admin
    }

    setLoading(userId)
    if (!profile?.id) return

    try {
      const res = await fetch('/api/pallet-records/users', {
        method: 'PUT',
        headers: {
          ...userHeaders(profile.id),
        },
        body: JSON.stringify({ userId, ...updates }),
      })

      if (res.ok) {
        setUsers(prev => prev.map(u => (u.id === userId ? { ...u, ...updates } : u)))
      }
    } catch { /* ignore */ }
    setLoading(null)
  }

  const startEditName = (user: AppUser) => {
    if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL) return
    setEditingName(user.id)
    setNameInput(user.name || '')
  }

  const saveName = async (userId: string) => {
    await updateUser(userId, { name: nameInput })
    setEditingName(null)
  }

  const addUser = async () => {
    if (!newEmail.includes('@')) {
      setAddError('Enter a valid Gmail address')
      return
    }
    setAddingUser(true)
    setAddError('')

    if (!profile?.id) return

    try {
      const res = await fetch('/api/pallet-records/users', {
        method: 'POST',
        headers: {
          ...userHeaders(profile.id),
        },
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim() || undefined,
          role: newRole,
        }),
      })

      const data = await res.json()
      if (res.ok && data.user) {
        setUsers(prev => [...prev, data.user])
        setNewEmail('')
        setNewName('')
        setNewRole('user')
        setShowAddForm(false)
      } else {
        setAddError(data.error || 'Failed to add user')
      }
    } catch {
      setAddError('Network error')
    }
    setAddingUser(false)
  }

  const statusColors: Record<UserStatus, string> = {
    active: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    pending: 'bg-amber-100 text-amber-700 border border-amber-200',
    disabled: 'bg-red-100 text-red-700 border border-red-200',
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl p-4 mb-4 shadow-lg">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">User Management</h1>
            <p className="text-muted-foreground text-sm">Gestión de Usuarios · {users.length} users</p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-2 bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-lg text-sm font-medium transition-colors"
          >
            {showAddForm ? '✕ Cancel' : '+ Add User'}
          </button>
        </div>
      </div>

      {/* Pre-register form */}
      {showAddForm && (
        <div className="bg-sky-50 dark:bg-sky-950 border border-blue-200 rounded-xl p-4 mb-4 space-y-3">
          <h3 className="font-semibold text-foreground text-sm">Pre-register Employee</h3>
          <p className="text-xs text-muted-foreground">Add their Gmail so they&apos;re auto-approved on first login.</p>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="employee@gmail.com"
            className="w-full border-2 border-border rounded-lg p-3 text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Display name (optional)"
            className="w-full border-2 border-border rounded-lg p-3 text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setNewRole('user')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                newRole === 'user' ? 'border-sky-500 dark:border-sky-400 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300' : 'border-border text-muted-foreground'
              }`}
            >
              👤 User
            </button>
            <button
              onClick={() => setNewRole('admin')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                newRole === 'admin' ? 'border-sky-500 dark:border-sky-400 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300' : 'border-border text-muted-foreground'
              }`}
            >
              🛡️ Admin
            </button>
          </div>
          {addError && <p className="text-red-600 text-sm">⚠️ {addError}</p>}
          <button
            onClick={addUser}
            disabled={addingUser || !newEmail}
            className="w-full py-3 bg-sky-600 text-white rounded-lg font-semibold active:bg-sky-700 disabled:opacity-50 shadow-sm"
          >
            {addingUser ? 'Adding...' : '✓ Pre-register'}
          </button>
        </div>
      )}

      {users.length === 0 && (
        <div className="text-center py-8 bg-card rounded-xl shadow-sm">
          <p className="text-muted-foreground">No users yet</p>
        </div>
      )}

      <div className="space-y-3">
        {users.map((u) => {
          const isSuperAdmin = u.email.toLowerCase() === SUPER_ADMIN_EMAIL

          return (
            <div key={u.id} className="bg-card rounded-xl p-4 border border-border shadow-sm space-y-3">
              <div className="flex items-center gap-3">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-semibold">
                    {u.name?.[0] || u.email[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {editingName === u.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="flex-1 border-2 border-sky-400 rounded-lg px-2 py-1 text-sm text-foreground focus:outline-none"
                        placeholder="Display name..."
                        autoFocus
                      />
                      <button
                        onClick={() => saveName(u.id)}
                        className="px-2 py-1 bg-sky-600 text-white rounded-lg text-xs font-medium"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setEditingName(null)}
                        className="px-2 py-1 bg-muted text-muted-foreground rounded-lg text-xs font-medium"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground truncate">{u.name || u.email}</p>
                      {!isSuperAdmin && (
                        <button
                          onClick={() => startEditName(u)}
                          className="text-muted-foreground hover:text-blue-500 text-xs"
                          title="Edit display name"
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground truncate">{u.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    isSuperAdmin ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-blue-200'
                  }`}>
                    {isSuperAdmin ? '👑 Super Admin' : u.role}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[u.status]}`}>
                    {u.status}
                  </span>
                  {!u.avatar_url && u.status === 'active' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                      ⏳ Pre-registered
                    </span>
                  )}
                </div>
              </div>

              {/* Actions — don't show for self or super admin */}
              {u.id !== currentUserId && !isSuperAdmin && (
                <div className="flex gap-2 flex-wrap pt-1">
                  <button
                    onClick={() => updateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
                    disabled={loading === u.id}
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted active:bg-muted disabled:opacity-50 text-muted-foreground font-medium"
                  >
                    {u.role === 'admin' ? '→ User' : '→ Admin'}
                  </button>

                  {u.status === 'pending' && (
                    <button
                      onClick={() => updateUser(u.id, { status: 'active' })}
                      disabled={loading === u.id}
                      className="px-3 py-2 text-sm rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 font-medium"
                    >
                      ✓ Approve
                    </button>
                  )}
                  {u.status === 'active' && (
                    <button
                      onClick={() => updateUser(u.id, { status: 'disabled' })}
                      disabled={loading === u.id}
                      className="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 font-medium"
                    >
                      ✕ Disable
                    </button>
                  )}
                  {u.status === 'disabled' && (
                    <button
                      onClick={() => updateUser(u.id, { status: 'active' })}
                      disabled={loading === u.id}
                      className="px-3 py-2 text-sm rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 font-medium"
                    >
                      ✓ Enable
                    </button>
                  )}
                </div>
              )}

              {isSuperAdmin && u.id !== currentUserId && (
                <p className="text-xs text-muted-foreground italic">🔒 Super admin — cannot be modified</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
