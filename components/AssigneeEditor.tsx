'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, UserPlus, X, Pencil, Trash2 } from 'lucide-react'

interface AssigneeEditorProps {
  line: string
  currentAssignee: string
  onUpdated: (line: string, newAssignee: string) => void
}

let cachedNames: string[] | null = null
let cacheTime = 0
const CACHE_TTL = 60_000 // 1 min

function invalidateCache() {
  cachedNames = null
  cacheTime = 0
}

export function AssigneeEditor({ line, currentAssignee, onUpdated }: AssigneeEditorProps) {
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newName, setNewName] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 4, left: rect.left })
  }, [])

  useEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return

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
      const target = e.target as Node
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false)
        setAddMode(false)
        setEditingName(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll (table scrolls away from dropdown)
  useEffect(() => {
    if (!open) return
    const handler = () => { setOpen(false); setAddMode(false); setEditingName(null) }
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  useEffect(() => {
    if (addMode && inputRef.current) inputRef.current.focus()
  }, [addMode])

  useEffect(() => {
    if (editingName && editInputRef.current) editInputRef.current.focus()
  }, [editingName])

  const handleSelect = async (name: string) => {
    if (name === currentAssignee) { setOpen(false); return }
    setSaving(true)
    try {
      const res = await fetch('/api/orders/assign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line, assigned_to: name }),
      })
      if (res.ok) {
        onUpdated(line, name)
        if (cachedNames && !cachedNames.includes(name)) {
          cachedNames = [...cachedNames, name].sort()
        }
      }
    } catch { /* silent */ }
    finally { setSaving(false); setOpen(false); setAddMode(false) }
  }

  const handleAddNew = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    // Prevent duplicates
    if (names.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      handleSelect(names.find(n => n.toLowerCase() === trimmed.toLowerCase())!)
      setNewName('')
      return
    }
    handleSelect(trimmed)
    setNewName('')
  }

  const handleRename = async (oldName: string) => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === oldName) { setEditingName(null); return }
    // Prevent duplicate
    if (names.some(n => n.toLowerCase() === trimmed.toLowerCase() && n !== oldName)) {
      setEditingName(null)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/orders/assign', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldName, new_name: trimmed }),
      })
      if (res.ok) {
        invalidateCache()
        setNames(prev => prev.map(n => n === oldName ? trimmed : n).sort())
        // Update current row if it was this assignee
        if (currentAssignee === oldName) onUpdated(line, trimmed)
      }
    } catch { /* silent */ }
    finally { setSaving(false); setEditingName(null) }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove "${name}" and unassign all their orders?`)) return
    setSaving(true)
    try {
      const res = await fetch('/api/orders/assign', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        invalidateCache()
        setNames(prev => prev.filter(n => n !== name))
        if (currentAssignee === name) onUpdated(line, '')
      }
    } catch { /* silent */ }
    finally { setSaving(false) }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm hover:bg-muted/60 transition-colors min-w-[80px] text-left"
        disabled={saving}
      >
        <span className={currentAssignee ? '' : 'text-muted-foreground italic'}>
          {saving ? '...' : currentAssignee || 'Unassigned'}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>

      {open && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-64 bg-popover border rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
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

              {/* Existing names with edit/delete */}
              {names.map(name => (
                <div key={name} className="group flex items-center hover:bg-muted/60">
                  {editingName === name ? (
                    <div className="flex-1 px-2 py-1 flex gap-1">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(name)
                          if (e.key === 'Escape') setEditingName(null)
                        }}
                        className="flex-1 px-2 py-0.5 text-sm border rounded bg-background min-w-0"
                      />
                      <button
                        className="px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                        onClick={() => handleRename(name)}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="flex-1 px-3 py-1.5 text-sm text-left flex items-center gap-2"
                        onClick={() => handleSelect(name)}
                      >
                        {name === currentAssignee ? (
                          <Check className="size-3 text-green-500 shrink-0" />
                        ) : (
                          <span className="size-3 shrink-0" />
                        )}
                        {name}
                      </button>
                      <button
                        className="px-1.5 py-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                        title="Edit name"
                        onClick={(e) => { e.stopPropagation(); setEditingName(name); setEditValue(name) }}
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        className="px-1.5 py-1 mr-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity"
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); handleDelete(name) }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </>
                  )}
                </div>
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
        </div>,
        document.body
      )}
    </div>
  )
}
