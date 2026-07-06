'use client'

import { useEffect, useState } from 'react'
import { FileDown, Loader2, ScrollText } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { authHeaders } from '@/lib/session-token'

interface ShippingDoc {
  dn: string
  date: string
  shipped: boolean
}

/**
 * Generated shipping documents (BOL + packing slip) for an order, listed per
 * Delivery Note and streamed from ERPNext on demand — always the current
 * document (signatures included), no stale stored copies. Covers wrapper-shipped
 * AND natively-scanned DNs, so every shipped order since the ERPNext cutover has
 * its documents downloadable here (Simon 2026-07-06).
 */
export function ErpShippingDocs({ soName }: { soName: string }) {
  const { t } = useI18n()
  const [docs, setDocs] = useState<ShippingDoc[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!soName) return
    let active = true
    fetch(`/api/erpnext/fulfillment/shipping-docs?so=${encodeURIComponent(soName)}`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((data) => {
        if (active) setDocs(Array.isArray(data?.documents) ? data.documents : [])
      })
      .catch(() => {
        if (active) setDocs([])
      })
    return () => {
      active = false
    }
  }, [soName])

  // Fetch with auth, then open — PWA/standalone gets the share sheet (AirPrint /
  // Save to Files); desktop gets the new-tab viewer. Mirrors the ship page.
  const openDocument = async (dn: string, type: 'bol' | 'packing') => {
    const key = `${dn}|${type}`
    setBusy(key)
    try {
      const res = await fetch(
        `/api/erpnext/fulfillment/document?dn=${encodeURIComponent(dn)}&type=${type}`,
        { headers: authHeaders() }
      )
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const fileName = `${type === 'bol' ? 'BOL' : 'PackingSlip'}-${dn}.pdf`
      const file = new File([blob], fileName, { type: 'application/pdf' })
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      if (standalone && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          return
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
        }
      }
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      // leave silently; the button re-enables for a retry
    } finally {
      setBusy(null)
    }
  }

  if (!soName || docs === null) return null
  if (docs.length === 0) return null

  return (
    <section className="rounded-xl border-l-4 border-l-emerald-500 bg-muted/20 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground">
        <ScrollText className="size-4" />
        <span>{t('shippingDocs.title')}</span>
      </div>
      <ul className="space-y-2">
        {docs.map((d) => (
          <li key={d.dn} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">
              {d.dn}
              {d.date ? ` · ${d.date}` : ''}
            </span>
            {(['bol', 'packing'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => openDocument(d.dn, type)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950"
              >
                {busy === `${d.dn}|${type}` ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileDown className="size-3.5" />
                )}
                {type === 'bol' ? t('shippingDocs.bol') : t('shippingDocs.packingSlip')}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}
