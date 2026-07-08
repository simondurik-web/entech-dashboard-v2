'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { authHeaders } from '@/lib/session-token'
import { useI18n } from '@/lib/i18n'

// Audit trail viewer for minimum edits (minimum_change_log): who changed which
// part's minimum, old -> new, when. Visible to the same roles that can edit
// (edit_minimums); the API enforces the permission again server-side.

interface LogRow {
  part_number: string
  old_minimum: number | null
  new_minimum: number
  changed_by_name: string | null
  changed_by_email: string | null
  changed_at: string
}

export function MinimumChangeLogModal({ onClose }: { onClose: () => void }) {
  const { t, language } = useI18n()
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetch('/api/erpnext/inventory/minimum?limit=200', { headers: authHeaders() })
      .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
      .then((data: LogRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError(true))
  }, [])

  const shown = (rows ?? []).filter(r =>
    !filter.trim() || r.part_number.toLowerCase().includes(filter.trim().toLowerCase())
  )

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[95vw] max-w-2xl max-h-[85vh] overflow-auto p-5 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">{t('inventory.minimumChangeLog')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700 transition-colors"><X className="size-5" /></button>
        </div>

        <input
          type="text"
          placeholder={t('inventory.minimumLogFilterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full mb-3 p-2 rounded-lg bg-muted border border-border text-sm"
        />

        {error && <p className="text-center text-destructive py-6">{t('inventory.minimumLogLoadFailed')}</p>}
        {!error && rows === null && <p className="text-center text-muted-foreground py-6">{t('inventoryPopover.loading')}</p>}
        {!error && rows !== null && shown.length === 0 && (
          <p className="text-center text-muted-foreground py-6">{t('inventory.minimumLogEmpty')}</p>
        )}

        {shown.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-zinc-700">
                <th className="py-1.5 pr-2">{t('table.partNumber')}</th>
                <th className="py-1.5 pr-2">{t('inventory.minimumLogChange')}</th>
                <th className="py-1.5 pr-2">{t('inventory.minimumLogBy')}</th>
                <th className="py-1.5">{t('inventory.minimumLogWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className="border-b border-zinc-800/60">
                  <td className="py-1.5 pr-2 font-semibold">{r.part_number}</td>
                  <td className="py-1.5 pr-2 tabular-nums">
                    <span className="text-muted-foreground">{r.old_minimum != null ? r.old_minimum.toLocaleString() : '—'}</span>
                    <span className="mx-1 text-muted-foreground/60">→</span>
                    <span className="font-semibold">{r.new_minimum.toLocaleString()}</span>
                  </td>
                  <td className="py-1.5 pr-2">{r.changed_by_name || r.changed_by_email || '—'}</td>
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">
                    {new Date(r.changed_at).toLocaleString(language === 'es' ? 'es-MX' : 'en-US', {
                      month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body
  )
}

export default MinimumChangeLogModal
