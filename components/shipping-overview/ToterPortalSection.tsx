'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, Truck } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { TOTER_PORTAL_URL, TOTER_ACTIVE_STATUSES, type ToterEntryStatus } from '@/lib/po-automation/toter'

interface ToterEntry {
  status: ToterEntryStatus
  shipment_number: string | null
  entered_at: string | null
}

function isActive(status: ToterEntryStatus | null): boolean {
  return status !== null && (TOTER_ACTIVE_STATUSES as readonly string[]).includes(status)
}

/**
 * Toter portal controls for a Ready-to-Ship order card. Mounted only for
 * Toter/Wastequip staged orders by a viewer who can access /po-automation.
 * Fetches the current entry status on mount and renders:
 *   - "Enter order in Toter portal" → POSTs to enqueue a request for claude-5
 *     (flips to a disabled "Entry requested…" until claude-5 finishes).
 *   - "Order entered" (disabled) once claude-5 has marked the entry entered.
 *   - "Toter Portal" → opens the Wastequip portal in a new tab.
 *
 * Remounted via key on the order line, so state resets per order.
 */
export function ToterPortalSection({
  line,
  ifNumber,
  poNumber,
  customer,
  userId,
}: {
  line: string
  ifNumber: string
  poNumber: string
  customer: string
  userId: string | null
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<ToterEntryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    const qs = new URLSearchParams({ line, if: ifNumber }).toString()
    fetch(`/api/po-automation/toter-portal?${qs}`, { headers: { 'x-user-id': userId || '' } })
      .then((r) => (r.ok ? r.json() : { entry: null }))
      .then((data: { entry: ToterEntry | null }) => {
        if (active) setStatus(data?.entry?.status ?? null)
      })
      .catch(() => {
        if (active) setStatus(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [line, ifNumber, userId])

  async function handleEnter() {
    setSubmitting(true)
    setError(false)
    try {
      const res = await fetch('/api/po-automation/toter-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '' },
        body: JSON.stringify({ line, ifNumber, poNumber, customer }),
      })
      if (!res.ok) throw new Error('request failed')
      const data: { entry: ToterEntry | null } = await res.json()
      setStatus(data?.entry?.status ?? 'queued')
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  const entered = status === 'entered'
  const pending = isActive(status) || submitting

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {entered ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            {t('toter.entered')}
          </span>
        ) : (
          <button
            type="button"
            onClick={handleEnter}
            disabled={loading || pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
            {pending ? t('toter.requested') : t('toter.enter')}
          </button>
        )}

        <a
          href={TOTER_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-500/10 dark:text-violet-300"
        >
          <ExternalLink className="size-4" />
          {t('toter.open')}
        </a>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{t('toter.error')}</p>}
      {pending && !error && <p className="text-xs text-muted-foreground">{t('toter.requestedHint')}</p>}
    </div>
  )
}
