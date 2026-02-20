'use client'

import { useEffect, useState } from 'react'
import { Bookmark, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/lib/auth-context'
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
  getCurrentConfig: () => DataTableViewConfig
  onApplyView: (config: DataTableViewConfig) => void
}

export function ViewsMenu({ page, getCurrentConfig, onApplyView }: ViewsMenuProps) {
  const { user, profile } = useAuth()
  const userId = profile?.email || user?.email || null
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function loadViews() {
    try {
      const headers: Record<string, string> = {}
      if (userId) headers['x-user-id'] = userId
      const res = await fetch(`/api/views?page=${encodeURIComponent(page)}`, { headers })
      if (!res.ok) return
      const data = await res.json()
      setViews(data)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (open) { loadViews(); setSaved(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, userId])

  async function saveView() {
    if (!newName.trim() || !userId) return
    setSaving(true)
    try {
      const res = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ page, name: newName.trim(), config: getCurrentConfig(), shared: true }),
      })
      if (res.ok) {
        setNewName('')
        setSaved(true)
        await loadViews()
        setTimeout(() => setSaved(false), 2000)
      }
    } finally { setSaving(false) }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Bookmark className="size-3.5" />
          <span className="hidden sm:inline">Custom Views</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-3">
        {userId ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Save Current View</p>
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="View name..."
                className="h-8"
                onKeyDown={(e) => { if (e.key === 'Enter') saveView() }}
              />
              <Button size="sm" onClick={saveView} disabled={saving || !newName.trim()}>
                {saved ? <Check className="size-3.5" /> : 'Save'}
              </Button>
            </div>
            {saved && <p className="text-xs text-green-500">✓ Saved! Find it in Reports.</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sign in to save custom views.</p>
        )}

        {views.length > 0 && (
          <div className="space-y-1 max-h-52 overflow-y-auto border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Quick Apply</p>
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => { onApplyView(v.config || {}); setOpen(false) }}
                className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <span className="font-medium">{v.name}</span>
                <span className="text-[11px] text-muted-foreground ml-2">by {v.user_id}</span>
              </button>
            ))}
          </div>
        )}

        <div className="border-t pt-2">
          <a href="/reports" className="text-xs text-blue-400 hover:underline">
            View all saved reports →
          </a>
        </div>
      </PopoverContent>
    </Popover>
  )
}
