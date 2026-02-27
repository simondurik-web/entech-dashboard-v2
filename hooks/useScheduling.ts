'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = await getToken()
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// --- Schedule Entries ---
export function useScheduleEntries(from: string, to: string, filters?: { shift?: number; search?: string }) {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (filters?.shift) params.set('shift', String(filters.shift))
      const data = await apiFetch<any[]>(`/api/scheduling/entries?${params}`)
      setEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch entries')
    } finally {
      setLoading(false)
    }
  }, [from, to, filters?.shift])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  return { entries, loading, error, refetch: fetchEntries }
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
      console.error("Scheduling fetch error:", err)
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
      console.error("Scheduling fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMachines() }, [fetchMachines])

  return { machines, loading, refetch: fetchMachines }
}

// --- Hours & Pay (admin/manager only) ---
export function useScheduleHours(from: string, to: string) {
  const { profile } = useAuth()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const isAllowed = profile?.role === 'admin' || profile?.role === 'super_admin' || profile?.role === 'manager'

  const fetchHours = useCallback(async () => {
    if (!isAllowed) { setLoading(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const result = await apiFetch<any[]>(`/api/scheduling/hours?${params}`)
      setData(result)
    } catch (err) {
      console.error("Scheduling fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [from, to, isAllowed])

  useEffect(() => { fetchHours() }, [fetchHours])

  return { data, loading, refetch: fetchHours }
}

// --- Mutations ---
export function useScheduleMutations() {
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
      body: JSON.stringify(entry),
    })
  }

  const deleteEntry = async (id: string) => {
    return apiFetch(`/api/scheduling/entries?id=${id}`, { method: 'DELETE' })
  }

  const addMachine = async (data: { name: string; department: string }) => {
    return apiFetch('/api/scheduling/machines', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  const updateMachine = async (id: string, data: Record<string, unknown>) => {
    return apiFetch('/api/scheduling/machines', {
      method: 'PUT',
      body: JSON.stringify({ id, ...data }),
    })
  }

  const deleteMachine = async (id: string) => {
    return apiFetch(`/api/scheduling/machines?id=${id}`, { method: 'DELETE' })
  }

  return { saveEntry, deleteEntry, addMachine, updateMachine, deleteMachine }
}
