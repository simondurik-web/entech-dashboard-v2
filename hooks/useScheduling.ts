'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'

/** Simple fetch wrapper — read endpoints need no auth, write endpoints send x-user-id */
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

/** Fetch with user ID header for write operations */
function authHeaders(userId: string): Record<string, string> {
  return { 'x-user-id': userId }
}

// --- Schedule Entries ---
export function useScheduleEntries(from: string, to: string, filters?: { shift?: number }) {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      if (filters?.shift) params.set('shift', String(filters.shift))
      const data = await apiFetch<any[]>(`/api/scheduling/entries?${params}`)
      setEntries(data)
    } catch (err) {
      console.error('Scheduling fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [from, to, filters?.shift])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  return { entries, loading, refetch: fetchEntries }
}

// --- Employees ---
export function useScheduleEmployees() {
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<any[]>('/api/scheduling/employees')
      setEmployees(data)
    } catch (err) {
      console.error('Scheduling fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  return { employees, loading, refetch: fetchEmployees }
}

// --- Machines ---
export function useScheduleMachines() {
  const [machines, setMachines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchMachines = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<any[]>('/api/scheduling/machines')
      setMachines(data)
    } catch (err) {
      console.error('Scheduling fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMachines() }, [fetchMachines])

  return { machines, loading, refetch: fetchMachines }
}

// --- Hours & Pay (admin/manager only) ---
export function useScheduleHours(from: string, to: string) {
  const { user, profile } = useAuth()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const isAllowed = profile?.role === 'admin' || profile?.role === 'super_admin' || profile?.role === 'manager'

  const fetchHours = useCallback(async () => {
    if (!isAllowed || !user?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const result = await apiFetch<{ rows: any[] }>(`/api/scheduling/hours?${params}`, {
        headers: authHeaders(user.id),
      })
      setData(result.rows || [])
    } catch (err) {
      console.error('Scheduling fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [from, to, isAllowed, user?.id])

  useEffect(() => { fetchHours() }, [fetchHours])

  return { data, loading, refetch: fetchHours }
}

// --- Mutations (need auth) ---
export function useScheduleMutations() {
  const { user } = useAuth()

  const getHeaders = () => user?.id ? authHeaders(user.id) : {}

  const saveEntry = async (entry: {
    employee_id: string
    date: string
    shift: number
    start_time: string
    end_time: string
    machine_id: string | null
    applyTo: 'day' | 'onward' | 'week'
  }) => {
    return apiFetch('/api/scheduling/entries', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(entry),
    })
  }

  const deleteEntry = async (id: string) => {
    return apiFetch(`/api/scheduling/entries?id=${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    })
  }

  const addMachine = async (data: { name: string; department: string }) => {
    return apiFetch('/api/scheduling/machines', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    })
  }

  const updateMachine = async (id: string, data: Record<string, unknown>) => {
    return apiFetch('/api/scheduling/machines', {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ id, ...data }),
    })
  }

  const deleteMachine = async (id: string) => {
    return apiFetch(`/api/scheduling/machines?id=${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    })
  }

  return { saveEntry, deleteEntry, addMachine, updateMachine, deleteMachine }
}
