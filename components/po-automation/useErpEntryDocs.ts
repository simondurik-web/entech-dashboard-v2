'use client'

import { useEffect, useState } from 'react'
import { authHeaders } from '@/lib/session-token'
import { isSafeStorageUrl } from '@/lib/po-automation/safe-url'
import type { OrderDocument } from '@/lib/po-automation/documents'

/** PDF vs image, by file URL / name — order_documents carry no MIME. */
export function isPdfDoc(doc: OrderDocument): boolean {
  return /\.pdf($|\?)/i.test(doc.file_url ?? '') || /\.pdf$/i.test(doc.file_name ?? '')
}

/**
 * ERP-entry proof documents (doc_type='erp_entry') for an order — the Sales
 * Order verification PDFs filed after an order is entered in ERPNext. They
 * render inside the "PO & ERP Entry" section; they are NOT bills of lading
 * (BillOfLadingSection lists doc_type='bol' only).
 */
export function useErpEntryDocs(customer: string, poNumber: string, enabled = true): OrderDocument[] {
  const [docs, setDocs] = useState<OrderDocument[]>([])

  // Callers remount via key on (customer, poNumber); state updates only happen
  // in async callbacks (same pattern as the sibling PO-section fetches).
  useEffect(() => {
    if (!enabled) return
    let active = true
    const qs = new URLSearchParams({ customer, po: poNumber }).toString()
    fetch(`/api/po-automation/documents?${qs}`, { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((data) => {
        if (!active) return
        const rows: OrderDocument[] = Array.isArray(data?.documents) ? data.documents : []
        setDocs(rows.filter((d) => d.doc_type === 'erp_entry' && isSafeStorageUrl(d.file_url)))
      })
      .catch(() => {
        if (active) setDocs([])
      })
    return () => {
      active = false
    }
  }, [customer, poNumber, enabled])

  // Derive rather than clear in the effect: if `enabled` flips off, stale docs
  // must not linger (callers usually remount via key, but don't rely on it).
  return enabled ? docs : []
}
