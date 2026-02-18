'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'

export type SortDir = 'asc' | 'desc' | null

export interface ColumnDef<T> {
  key: keyof T & string
  label: string
  sortable?: boolean
  filterable?: boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

export interface UseDataTableOptions<T> {
  data: T[]
  columns: ColumnDef<T>[]
  storageKey?: string
}

export interface UseDataTableReturn<T> {
  columns: ColumnDef<T>[]
  visibleColumns: ColumnDef<T>[]
  processedData: T[]
  sortKey: string | null
  sortDir: SortDir
  filters: Map<string, Set<string>>
  hiddenColumns: Set<string>
  columnOrder: string[]
  searchTerm: string
  toggleSort: (key: string) => void
  setFilter: (key: string, values: Set<string>) => void
  clearFilter: (key: string) => void
  clearAllFilters: () => void
  toggleColumn: (key: string) => void
  setSearch: (term: string) => void
  moveColumn: (fromIndex: number, toIndex: number) => void
}

export function useDataTable<T extends Record<string, unknown>>({
  data,
  columns,
  storageKey,
}: UseDataTableOptions<T>): UseDataTableReturn<T> {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [filters, setFilters] = useState<Map<string, Set<string>>>(() => new Map())
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`dt-hidden-${storageKey}`)
        if (stored) return new Set(JSON.parse(stored))
      } catch { /* ignore */ }
    }
    return new Set()
  })
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`dt-order-${storageKey}`)
        if (stored) return JSON.parse(stored)
      } catch { /* ignore */ }
    }
    return columns.map((c) => c.key)
  })
  const [searchTerm, setSearchTerm] = useState('')
  const sortDirRef = useRef(sortDir)
  sortDirRef.current = sortDir

  // Sync column order when columns change (new columns added)
  useEffect(() => {
    const colKeys = new Set(columns.map((c) => c.key))
    const orderKeys = new Set(columnOrder)
    const missing = columns.filter((c) => !orderKeys.has(c.key)).map((c) => c.key)
    if (missing.length > 0) {
      setColumnOrder((prev) => [...prev.filter((k) => colKeys.has(k)), ...missing])
    }
  }, [columns]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist hidden columns
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(`dt-hidden-${storageKey}`, JSON.stringify([...hiddenColumns]))
    }
  }, [hiddenColumns, storageKey])

  // Persist column order
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(`dt-order-${storageKey}`, JSON.stringify(columnOrder))
    }
  }, [columnOrder, storageKey])

  const toggleSort = useCallback((key: string) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir('asc')
        return key
      }
      const currentDir = sortDirRef.current
      if (currentDir === 'asc') {
        setSortDir('desc')
        return key
      }
      setSortDir(null)
      return null
    })
  }, [])

  const setFilter = useCallback((key: string, values: Set<string>) => {
    setFilters((prev) => {
      const next = new Map(prev)
      if (values.size === 0) {
        next.delete(key)
      } else {
        next.set(key, values)
      }
      return next
    })
  }, [])

  const clearFilter = useCallback((key: string) => {
    setFilters((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setFilters(new Map())
    setSearchTerm('')
    setSortKey(null)
    setSortDir(null)
  }, [])

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const moveColumn = useCallback((fromIndex: number, toIndex: number) => {
    setColumnOrder((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  // Order columns by columnOrder, then filter hidden
  const orderedColumns = useMemo(() => {
    const colMap = new Map(columns.map((c) => [c.key, c]))
    const ordered: ColumnDef<T>[] = []
    for (const key of columnOrder) {
      const col = colMap.get(key)
      if (col) ordered.push(col)
    }
    // Add any columns not in order (safety)
    for (const col of columns) {
      if (!columnOrder.includes(col.key)) ordered.push(col)
    }
    return ordered
  }, [columns, columnOrder])

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => !hiddenColumns.has(c.key)),
    [orderedColumns, hiddenColumns]
  )

  const processedData = useMemo(() => {
    let result = [...data]

    // Global search
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      result = result.filter((row) =>
        columns.some((col) => {
          const val = row[col.key]
          return val !== null && val !== undefined && String(val).toLowerCase().includes(q)
        })
      )
    }

    // Column filters
    for (const [key, allowedValues] of filters) {
      result = result.filter((row) => {
        const val = String(row[key as keyof T] ?? '')
        return allowedValues.has(val)
      })
    }

    // Sort
    if (sortKey && sortDir) {
      result.sort((a, b) => {
        const aVal = a[sortKey as keyof T]
        const bVal = b[sortKey as keyof T]

        if (aVal === null || aVal === undefined) return 1
        if (bVal === null || bVal === undefined) return -1

        let cmp = 0
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal
        } else {
          cmp = String(aVal).localeCompare(String(bVal))
        }
        return sortDir === 'desc' ? -cmp : cmp
      })
    }

    return result
  }, [data, searchTerm, filters, sortKey, sortDir, columns])

  return {
    columns: orderedColumns,
    visibleColumns,
    processedData,
    sortKey,
    sortDir,
    filters,
    hiddenColumns,
    columnOrder,
    searchTerm,
    toggleSort,
    setFilter,
    clearFilter,
    clearAllFilters,
    toggleColumn,
    setSearch: setSearchTerm,
    moveColumn,
  }
}
