'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, Truck } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { TOTER_PORTAL_URL, TOTER_ACTIVE_STATUSES, type ToterEntryStatus } from '@/lib/po-automation/toter'

interface ToterEntry {
  status: ToterEntryStatus
  shipment_number: string | null
  entered_at: string | null
  error: string | null
}

function isActive(status: ToterEntryStatus | null): boolean {
  return status !== null && (TOTER_ACTIVE_STATUSES as readonly string[]).includes(status)
}

const POLL_MS = 15000

/**
 * Toter portal controls for a Ready-to-Ship order card. Mounted only for
 * Toter/Wastequip staged orders by a viewer who can access /po-automation.
 * Fetches the current entry status on mount, polls while a request is in flight,
 * and renders:
 *   - "Enter order in Toter portal" → POSTs to enqueue a request for claude-5
 *     (flips to a disabled "Entry requested…" until claude-5 finishes).
 *   - "Order entered" (disabled) once claude-5 has marked the entry entered.
 *   - A failure line + re-enabled button if a prior attempt failed.
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
  const [shipment, setShipment] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [clientError, setClientError] = useState(false)

  const applyEntry = useCallback((entry: ToterEntry | null) => {
    setStatus(entry?.status ?? null)
    setShipment(entry?.shipment_number ?? null)
    setServerError(entry?.status === 'failed' ? entry?.error ?? null : null)
  }, [])

  const fetchStatus = useCallback(async (): Promise<void> => {
    const qs = new URLSearchParams({ line, if: ifNumber }).toString()
    try {
      const r = await fetch(`/api/po-automation/toter-portal?${qs}`, { headers: { 'x-user-id': userId || '' } })
      const data: { entry: ToterEntry | null } = r.ok ? await r.json() : { entry: null }
      applyEntry(data?.entry ?? null)
    } catch {
      applyEntry(null)
    }
  }, [line, ifNumber, userId, applyEntry])

  // Initial load.
  useEffect(() => {
    let active = true
    fetchStatus().finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [fetchStatus])

  // Poll only while a request is in flight, so the button updates to
  // "Order entered" (or back to actionable on failure) without a manual refresh.
  useEffect(() => {
    if (!isActive(status)) return
    const id = setInterval(fetchStatus, POLL_MS)
    return () => clearInterval(id)
  }, [status, fetchStatus])

  async function handleEnter() {
    setSubmitting(true)
    setClientError(false)
    try {
      const res = await fetch('/api/po-automation/toter-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '' },
        body: JSON.stringify({ line, ifNumber, poNumber, customer }),
      })
      if (!res.ok) throw new Error('request failed')
      const data: { entry: ToterEntry | null } = await res.json()
      applyEntry(data?.entry ?? { status: 'queued', shipment_number: null, entered_at: null, error: null })
    } catch {
      setClientError(true)
    } finally {
      setSubmitting(false)
    }
  }

  const entered = status === 'entered'
  const pending = isActive(status) || submitting
  const failed = status === 'failed'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {entered ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            {t('toter.entered')}
            {shipment && <span className="font-normal text-emerald-700/70 dark:text-emerald-400/70">#{shipment}</span>}
          </span>
        ) : (
          <button
            type="button"
            onClick={handleEnter}
            disabled={loading || pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading || pending ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
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

      <div aria-live="polite">
        {clientError && <p className="text-xs text-red-600 dark:text-red-400">{t('toter.error')}</p>}
        {failed && !clientError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {t('toter.failed')}
            {serverError ? ` — ${serverError}` : ''}
          </p>
        )}
        {pending && !clientError && <p className="text-xs text-muted-foreground">{t('toter.requestedHint')}</p>}
      </div>
    </div>
  )
}
