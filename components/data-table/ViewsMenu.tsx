'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Globe, Lock, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { DataTableViewConfig } from '@/lib/use-data-table'

interface SavedView {
  id: string
  user_id: string
  page: string
  name: string
  config: DataTableViewConfig
  shared: boolean
  created_at: string
}

interface ViewsMenuProps {
  page: string
  userId: string
  getCurrentConfig: () => DataTableViewConfig
  onApplyView: (config: DataTableViewConfig) => void
}

export function ViewsMenu({ page, userId, getCurrentConfig, onApplyView }: ViewsMenuProps) {
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const ownViews = useMemo(() => views.filter((v) => v.user_id === userId), [views, userId])
  const sharedViews = useMemo(() => views.filter((v) => v.user_id !== userId && v.shared), [views, userId])

  async function loadViews() {
    const res = await fetch(`/api/views?page=${encodeURIComponent(page)}`, {
      headers: { 'x-user-id': userId },
    })
    if (!res.ok) return
    const data = await res.json()
    setViews(data)
  }

  useEffect(() => {
    if (open) loadViews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, userId])

  async function saveCurrentView() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/views', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          page,
          name: newName.trim(),
          config: getCurrentConfig(),
          shared: false,
        }),
      })
      if (res.ok) {
        setNewName('')
        await loadViews()
      }
    } finally {
      setSaving(false)
    }
  }

  async function deleteView(id: string) {
    const res = await fetch(`/api/views/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': userId },
    })
    if (res.ok) await loadViews()
  }

  async function renameView(view: SavedView) {
    const next = prompt('Rename view', view.name)
    if (!next || !next.trim()) return
    const res = await fetch(`/api/views/${view.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ name: next.trim() }),
    })
    if (res.ok) await loadViews()
  }

  async function toggleShare(view: SavedView) {
    const res = await fetch(`/api/views/${view.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ shared: !view.shared }),
    })
    if (res.ok) await loadViews()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Bookmark className="size-3.5" />
          <span className="hidden sm:inline">Views</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3 space-y-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Save Current View</p>
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="View name"
              className="h-8"
            />
            <Button size="sm" onClick={saveCurrentView} disabled={saving || !newName.trim()}>
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {ownViews.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">My Views</p>
              {ownViews.map((v) => (
                <div key={v.id} className="rounded border p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="text-sm font-medium hover:underline text-left"
                      onClick={() => onApplyView(v.config || {})}
                    >
                      {v.name}
                    </button>
                    <div className="flex items-center gap-1">
                      <button className="p-1 hover:bg-muted rounded" title="Rename" onClick={() => renameView(v)}>
                        <Pencil className="size-3" />
                      </button>
                      <button className="p-1 hover:bg-muted rounded" title={v.shared ? 'Unshare' : 'Share'} onClick={() => toggleShare(v)}>
                        {v.shared ? <Globe className="size-3" /> : <Lock className="size-3" />}
                      </button>
                      <button className="p-1 hover:bg-muted rounded text-destructive" title="Delete" onClick={() => deleteView(v.id)}>
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sharedViews.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Shared Views</p>
              {sharedViews.map((v) => (
                <div key={v.id} className="rounded border p-2">
                  <button className="text-sm font-medium hover:underline text-left" onClick={() => onApplyView(v.config || {})}>
                    {v.name}
                  </button>
                  <p className="text-[11px] text-muted-foreground">by {v.user_id}</p>
                </div>
              ))}
            </div>
          )}

          {ownViews.length === 0 && sharedViews.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No saved views yet.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
