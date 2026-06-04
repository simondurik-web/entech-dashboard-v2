'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { RefreshCw, FileText, CheckCircle2, AlertTriangle, Copy, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'
import type {
  PoAutomationResponse,
  PoAutomationStats,
  PoStatus,
  ProcessedPo,
} from '@/lib/po-automation/types'

const STATUS_STYLES: Record<PoStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  claimed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  entered: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  skipped_duplicate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  manual_override: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function PoAutomationPage() {
  const { t } = useI18n()
  const [data, setData] = useState<PoAutomationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/po-automation', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as PoAutomationResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => data?.records ?? [], [data])
  const stats: PoAutomationStats | null = data?.stats ?? null

  const statusLabel = useCallback(
    (s: PoStatus) => t(`po.status.${s}`),
    [t]
  )

  const columns: ColumnDef<ProcessedPo>[] = useMemo(
    () => [
      {
        key: 'po_number',
        label: t('po.col.poNumber'),
        sortable: true,
        filterable: true,
        render: (v) => (v ? String(v) : '—'),
      },
      {
        key: 'party',
        label: t('po.col.party'),
        sortable: true,
        filterable: true,
        render: (v, row) => {
          const r = row as ProcessedPo
          return (
            <span>
              {v ? String(v) : '—'}
              {r.party_type !== 'unknown' && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({t(`po.partyType.${r.party_type}`)})
                </span>
              )}
            </span>
          )
        },
      },
      {
        key: 'status',
        label: t('po.col.status'),
        sortable: true,
        filterable: true,
        render: (v) => {
          const s = v as PoStatus
          return (
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s] ?? ''}`}>
              {statusLabel(s)}
            </span>
          )
        },
      },
      {
        key: 'entered_via',
        label: t('po.col.enteredVia'),
        sortable: true,
        filterable: true,
        render: (v) => (v ? t(`po.via.${v as string}`) : '—'),
      },
      {
        key: 'claimed_by',
        label: t('po.col.claimedBy'),
        sortable: true,
        filterable: true,
        render: (v) => (v ? String(v) : '—'),
      },
      {
        key: 'filemaker_record_id',
        label: t('po.col.fmRecord'),
        sortable: true,
        render: (v) => (v ? String(v) : '—'),
      },
      {
        key: 'attempts',
        label: t('po.col.attempts'),
        sortable: true,
        render: (v) => String(v ?? 0),
      },
      {
        key: 'created_at',
        label: t('po.col.created'),
        sortable: true,
        render: (v) => fmtDate(v as string | null),
      },
      {
        key: 'error',
        label: t('po.col.error'),
        render: (v) =>
          v ? <span className="text-xs text-red-600">{String(v)}</span> : '—',
      },
    ],
    [t, statusLabel]
  )

  const table = useDataTable({ data: rows, columns, storageKey: 'po-automation' })

  const statCards = stats
    ? [
        { label: t('po.stat.pending'), value: stats.pending, icon: <Clock className="size-4" />, tone: 'text-slate-600' },
        { label: t('po.stat.enteredToday'), value: stats.entered_today, icon: <CheckCircle2 className="size-4" />, tone: 'text-green-600' },
        { label: t('po.stat.duplicates'), value: stats.duplicates_skipped, icon: <Copy className="size-4" />, tone: 'text-amber-600' },
        { label: t('po.stat.failed'), value: stats.failed, icon: <AlertTriangle className="size-4" />, tone: 'text-red-600' },
        { label: t('po.stat.total'), value: stats.total, icon: <FileText className="size-4" />, tone: 'text-blue-600' },
      ]
    : []

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">📥 {t('po.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('po.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {t('po.refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('po.loadError')}: {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {statCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className={`flex items-center gap-2 text-sm font-medium ${c.tone}`}>
                {c.icon}
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <p className="mb-1 text-lg">{t('po.empty.title')}</p>
          <p className="text-sm">{t('po.empty.subtitle')}</p>
        </div>
      ) : (
        <DataTable
          table={table}
          data={rows}
          noun="PO"
          exportFilename="po-automation-queue"
          page="po-automation"
        />
      )}
    </div>
  )
}
