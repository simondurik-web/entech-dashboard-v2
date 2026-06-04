'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import type { PurchasingAudit } from '@/lib/purchasing/types'

function fmtDateTime(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

const ACTION_STYLES: Record<string, string> = {
  created: 'text-green-600 dark:text-green-400',
  updated: 'text-blue-600 dark:text-blue-400',
  deleted: 'text-red-600 dark:text-red-400',
  restored: 'text-amber-600 dark:text-amber-400',
}

export function AuditTrailPanel({ refreshKey }: { refreshKey?: number }) {
  const { t } = useI18n()
  const [entries, setEntries] = useState<PurchasingAudit[] | null>(null)

  const load = useCallback(() => {
    setEntries(null)
    fetch('/api/purchasing/audit?limit=300')
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]))
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('purchasing.auditDescription')}</p>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="mr-1.5 size-3.5" />{t('ui.refresh')}
        </Button>
      </div>
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">{t('purchasing.audit.when')}</th>
              <th className="px-3 py-2 font-medium">{t('purchasing.audit.action')}</th>
              <th className="px-3 py-2 font-medium">{t('purchasing.col.itemDescription')}</th>
              <th className="px-3 py-2 font-medium">{t('purchasing.audit.change')}</th>
              <th className="px-3 py-2 font-medium">{t('purchasing.audit.by')}</th>
            </tr>
          </thead>
          <tbody>
            {entries === null && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('ui.loading')}</td></tr>
            )}
            {entries?.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('purchasing.noHistory')}</td></tr>
            )}
            {entries?.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDateTime(e.created_at)}</td>
                <td className={`px-3 py-2 font-medium ${ACTION_STYLES[e.action] ?? ''}`}>{t(`purchasing.action.${e.action}`)}</td>
                <td className="px-3 py-2">{e.item_description || '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {e.field_name ? (
                    <span>{e.field_name}: <span className="line-through">{e.old_value ?? '∅'}</span> → <span className="text-foreground">{e.new_value ?? '∅'}</span></span>
                  ) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{e.performed_by_name || e.performed_by_email || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
