'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { DataTableViewConfig } from './use-data-table'

/**
 * If `?viewId=xxx` is in the URL, fetch the saved view config
 * and return it so the DataTable can apply it on mount.
 */
export function useViewFromUrl(): DataTableViewConfig | null {
  const searchParams = useSearchParams()
  const viewId = searchParams.get('viewId')
  const [config, setConfig] = useState<DataTableViewConfig | null>(null)

  useEffect(() => {
    if (!viewId) return
    fetch(`/api/views/${viewId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.config) setConfig(data.config)
      })
      .catch(() => {})
  }, [viewId])

  return config
}

/**
 * Returns the autoExport param if present ('csv' | 'xlsx' | null)
 */
export function useAutoExport(): 'csv' | 'xlsx' | null {
  const searchParams = useSearchParams()
  const val = searchParams.get('autoExport')
  if (val === 'csv' || val === 'xlsx') return val
  return null
}
