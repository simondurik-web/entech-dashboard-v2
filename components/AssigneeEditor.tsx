'use client'

import { useState, useEffect, useRef } from 'react'
import { Check, ChevronDown, UserPlus, X } from 'lucide-react'

interface AssigneeEditorProps {
  line: string
  currentAssignee: string
  onUpdated: (line: string, newAssignee: string) => void
}

let cachedNames: string[] | null = null
let cacheTime = 0
const CACHE_TTL = 60_000 // 1 min

export function AssigneeEditor({ line, currentAssignee, onUpdated }: AssigneeEditorProps) {
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [newName, setNewName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    // Fetch names (with cache)
    if (cachedNames && Date.now() - cacheTime < CACHE_TTL) {
      setNames(cachedNames)
      return
    }

    setLoading(true)
    fetch('/api/orders/assign')
      .then(r => r.json())
      .then(data => {
        cachedNames = data.names || []
        cacheTime = Date.now()
        setNames(cachedNames!)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setAddMode(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus input when add mode opens
  useEffect(() => {
    if (addMode && inputRef.current) inputRef.current.focus()
  }, [addMode])

  const handleSelect = async (name: string) => {
    if (name === currentAssignee) {
      setOpen(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/orders/assign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line, assigned_to: name }),
      })
      if (res.ok) {
        onUpdated(line, name)
        // Add to cache if new
        if (cachedNames && !cachedNames.includes(name)) {
          cachedNames = [...cachedNames, name].sort()
        }
      }
    } catch {
      // silent fail
    } finally {
      setSaving(false)
      setOpen(false)
      setAddMode(false)
    }
  }

  const handleAddNew = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    handleSelect(trimmed)
    setNewName('')
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm hover:bg-muted/60 transition-colors min-w-[80px] text-left"
        disabled={saving}
      >
        <span className={currentAssignee ? '' : 'text-muted-foreground italic'}>
          {saving ? '...' : currentAssignee || 'Unassigned'}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-52 bg-popover border rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
          ) : (
            <>
              {/* Unassign option */}
              {currentAssignee && (
                <button
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted/60 flex items-center gap-2 text-muted-foreground"
                  onClick={() => handleSelect('')}
                >
                  <X className="size-3" />
                  Unassign
                </button>
              )}

              {/* Existing names */}
              {names.map(name => (
                <button
                  key={name}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted/60 flex items-center gap-2"
                  onClick={() => handleSelect(name)}
                >
                  {name === currentAssignee ? (
                    <Check className="size-3 text-green-500" />
                  ) : (
                    <span className="size-3" />
                  )}
                  {name}
                </button>
              ))}

              {/* Divider */}
              <div className="border-t my-1" />

              {/* Add new */}
              {addMode ? (
                <div className="px-2 py-1.5 flex gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddNew()
                      if (e.key === 'Escape') { setAddMode(false); setNewName('') }
                    }}
                    placeholder="Name..."
                    className="flex-1 px-2 py-1 text-sm border rounded bg-background"
                  />
                  <button
                    className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                    onClick={handleAddNew}
                    disabled={!newName.trim()}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted/60 flex items-center gap-2 text-primary"
                  onClick={() => setAddMode(true)}
                >
                  <UserPlus className="size-3" />
                  Add person
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
