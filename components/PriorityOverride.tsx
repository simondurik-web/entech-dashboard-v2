'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import { supabase } from '@/lib/supabase'
import type { PriorityValue } from '@/lib/priority'

const PRIORITY_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'P1', label: 'P1', color: 'bg-red-500/20 text-red-600 hover:bg-red-500/30' },
  { value: 'P2', label: 'P2', color: 'bg-orange-500/20 text-orange-600 hover:bg-orange-500/30' },
  { value: 'P3', label: 'P3', color: 'bg-yellow-500/20 text-yellow-600 hover:bg-yellow-500/30' },
  { value: 'P4', label: 'P4', color: 'bg-blue-500/20 text-blue-600 hover:bg-blue-500/30' },
  { value: 'URGENT', label: 'URGENT', color: 'bg-red-500 text-white hover:bg-red-600' },
  { value: 'RESET', label: '↺ Reset', color: 'bg-muted text-muted-foreground hover:bg-muted/80' },
]

interface PriorityOverrideProps {
  line: string
  currentPriority: PriorityValue
  isOverridden: boolean
  onUpdate: (line: string, newPriority: PriorityValue) => void
}

export function PriorityOverride({ line, currentPriority, isOverridden, onUpdate }: PriorityOverrideProps) {
  const { user, profile } = useAuth()
  const { canAccess } = usePermissions()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Check permission: admin always, or manage_priority in role/custom permissions
  const canManage = profile?.role === 'admin' || canAccess('manage_priority')

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Clear error after 3s
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(t)
  }, [error])

  if (!canManage) return null

  const handleSelect = async (value: string) => {
    setLoading(true)
    setOpen(false)
    setError(null)

    const newPriority = value === 'RESET' ? null : value

    try {
      if (!user?.id) {
        setError('Not logged in')
        setLoading(false)
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      
      const res = await fetch('/api/orders/priority', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ line, priority: newPriority }),
      })

      if (res.ok) {
        onUpdate(line, newPriority as PriorityValue)
      } else {
        const err = await res.json()
        setError(err.error || 'Failed')
        console.error('Priority update failed:', err)
      }
    } catch (err) {
      setError('Network error')
      console.error('Priority update error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(!open)
        }}
        disabled={loading}
        className="ml-1 p-0.5 rounded hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
        title="Override priority"
      >
        {loading ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="30 70" />
          </svg>
        ) : (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        )}
      </button>

      {isOverridden && (
        <span className="ml-0.5 text-[8px] text-amber-500" title="Manually overridden">📌</span>
      )}

      {error && (
        <span className="absolute z-50 top-full left-0 mt-1 px-2 py-1 text-[10px] bg-red-500 text-white rounded shadow whitespace-nowrap">
          {error}
        </span>
      )}

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-1 min-w-[100px]"
          onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleSelect(opt.value)
              }}
              className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors mb-0.5 ${opt.color} ${
                currentPriority === opt.value ? 'ring-1 ring-primary' : ''
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
