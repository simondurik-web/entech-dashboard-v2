'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Search, MapPin, Package, Loader2, AlertCircle } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { usePermissions } from '@/lib/use-permissions'

interface BinLocation {
  warehouse: string
  qty: number
}

interface LocateResult {
  itemCode: string
  itemName: string
  uom: string
  total: number
  bins: BinLocation[]
}

export default function InventoryOpsPage() {
  const { t } = useI18n()
  const { canAccess } = usePermissions()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocateResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([])
        setSearched(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/erpnext/locate?q=${encodeURIComponent(q.trim())}`)
        if (!res.ok) throw new Error('lookup failed')
        const data = await res.json()
        setResults(data.results ?? [])
        setSearched(true)
      } catch {
        setError(t('inventoryOps.error'))
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(query), 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  if (!canAccess('/inventory-ops')) {
    return (
      <div className="p-8 text-sm text-muted-foreground">{t('inventoryOps.noAccess')}</div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Package className="h-6 w-6" />
          {t('inventoryOps.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('inventoryOps.subtitle')}</p>
      </header>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('inventoryOps.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {!error && searched && !loading && results.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('inventoryOps.noResults')}</p>
      )}

      <div className="space-y-4">
        {results.map((r) => (
          <div key={r.itemCode} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="font-medium">{r.itemName}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.itemCode}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">
                  {r.total.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.uom} {t('inventoryOps.onHand')}
                </div>
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              {r.bins.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t('inventoryOps.noStock')}</div>
              ) : (
                <ul className="space-y-1.5">
                  {r.bins.map((b, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {b.warehouse}
                      </span>
                      <span className="font-medium tabular-nums">{b.qty.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
