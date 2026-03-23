'use client'

import { Suspense, useEffect, useState, useMemo, useCallback } from 'react'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import { useCountUp } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Plus, Eye, Printer, Mail } from 'lucide-react'
import { LabelPreviewModal } from '@/components/labels/LabelPreviewModal'
import { GenerateLabelsDialog } from '@/components/labels/GenerateLabelsDialog'
import { LabelSettings } from '@/components/labels/LabelSettings'
import type { LabelData } from '@/lib/label-utils'
import { getLabelStatusColor } from '@/lib/label-utils'

type LabelRow = LabelData & Record<string, unknown>

function getColumns(t: (key: string) => string, onView: (label: LabelData) => void, onPrint: (label: LabelData) => void): ColumnDef<LabelRow>[] {
  return [
    { key: 'order_line', label: t('table.line'), sortable: true, filterable: true },
    { key: 'customer_name', label: t('table.customer'), sortable: true, filterable: true },
    { key: 'part_number', label: t('table.partNumber'), sortable: true, filterable: true },
    { key: 'order_qty', label: t('table.qty'), sortable: true, render: (v) => (v as number).toLocaleString() },
    { key: 'num_packages', label: t('table.packages'), sortable: true, render: (v) => String(v || '-') },
    {
      key: 'label_status',
      label: t('labels.status'),
      sortable: true,
      filterable: true,
      render: (v) => (
        <Badge className={getLabelStatusColor(String(v))}>
          {String(v).toUpperCase()}
        </Badge>
      ),
    },
    { key: 'assigned_to', label: t('labels.assignedTo'), sortable: true, filterable: true, render: (v) => String(v || '-') },
    {
      key: 'generated_at',
      label: t('labels.generatedAt'),
      sortable: true,
      render: (v) => v ? new Date(String(v)).toLocaleDateString() : '-',
    },
    {
      key: 'id' as keyof LabelRow & string,
      label: t('labels.actions'),
      render: (_v, row) => {
        const label = row as unknown as LabelData
        return (
          <span className="inline-flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onView(label) }}
              className="rounded p-1 hover:bg-muted"
              title={t('labels.preview')}
            >
              <Eye className="size-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPrint(label) }}
              className="rounded p-1 hover:bg-muted"
              title={t('labels.print')}
            >
              <Printer className="size-4" />
            </button>
          </span>
        )
      },
    },
  ]
}

export default function LabelsPage() {
  return <Suspense><LabelsPageContent /></Suspense>
}

function LabelsPageContent() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { canAccess } = usePermissions()
  const [labels, setLabels] = useState<LabelData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewLabel, setPreviewLabel] = useState<LabelData | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [activeTab, setActiveTab] = useState('labels')

  const fetchLabels = useCallback(() => {
    setLoading(true)
    fetch('/api/labels')
      .then(r => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLabels(data)
        else setError('Failed to load labels')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchLabels() }, [fetchLabels])

  const handleView = useCallback((label: LabelData) => {
    setPreviewLabel(label)
    setShowPreview(true)
  }, [])

  const handlePrint = useCallback((label: LabelData) => {
    setPreviewLabel(label)
    setShowPreview(true)
    // Mark as printed
    if (label.id && user) {
      fetch(`/api/labels/${label.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ label_status: 'printed' }),
      }).then(() => fetchLabels())
    }
  }, [user, fetchLabels])

  const columns = useMemo(() => getColumns(t, handleView, handlePrint), [t, handleView, handlePrint])

  const data = labels as LabelRow[]

  const table = useDataTable({
    data,
    columns,
    storageKey: 'labels',
  })

  // Stats
  const totalCount = labels.length
  const pendingCount = labels.filter(l => l.label_status === 'pending').length
  const generatedCount = labels.filter(l => l.label_status === 'generated').length
  const printedCount = labels.filter(l => l.label_status === 'printed').length

  const animTotal = useCountUp(totalCount)
  const animPending = useCountUp(pendingCount)
  const animGenerated = useCountUp(generatedCount)
  const animPrinted = useCountUp(printedCount)

  const canGenerate = canAccess('labels:generate')
  const canSettings = canAccess('labels:settings')

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">🏷️ {t('page.labels')}</h1>
          <p className="text-muted-foreground text-sm">{t('page.labelsSubtitle')}</p>
        </div>
        {canGenerate && (
          <Button onClick={() => setShowGenerate(true)}>
            <Plus className="size-4 mr-1" />
            {t('labels.generateLabels')}
          </Button>
        )}
      </div>

      {/* Stats */}
      <ScrollReveal>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <SpotlightCard className="bg-muted rounded-lg p-3" spotlightColor="148,163,184">
            <p className="text-xs text-muted-foreground">{t('labels.totalLabels')}</p>
            <p className="text-xl font-bold">{animTotal}</p>
          </SpotlightCard>
          <SpotlightCard className="bg-yellow-500/10 rounded-lg p-3" spotlightColor="234,179,8">
            <p className="text-xs text-yellow-600">{t('labels.pending')}</p>
            <p className="text-xl font-bold text-yellow-600">{animPending}</p>
          </SpotlightCard>
          <SpotlightCard className="bg-blue-500/10 rounded-lg p-3" spotlightColor="59,130,246">
            <p className="text-xs text-blue-600">{t('labels.generated')}</p>
            <p className="text-xl font-bold text-blue-600">{animGenerated}</p>
          </SpotlightCard>
          <SpotlightCard className="bg-green-500/10 rounded-lg p-3" spotlightColor="34,197,94">
            <p className="text-xs text-green-600">{t('labels.printed')}</p>
            <p className="text-xl font-bold text-green-600">{animPrinted}</p>
          </SpotlightCard>
        </div>
      </ScrollReveal>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="labels">🏷️ {t('page.labels')}</TabsTrigger>
          {canSettings && <TabsTrigger value="settings">⚙️ {t('labels.settings')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="labels" className="mt-4">
          {loading && <TableSkeleton rows={8} />}
          {error && <p className="text-center text-destructive py-10">{error}</p>}
          {!loading && !error && (
            <DataTable
              table={table}
              data={data}
              noun={t('labels.noun')}
              exportFilename="labels"
              page="labels"
              getRowKey={(row) => (row as unknown as LabelData).id || (row as unknown as LabelData).order_line}
              onRowClick={(row) => handleView(row as unknown as LabelData)}
              renderCard={(row) => {
                const label = row as unknown as LabelData
                return (
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{label.order_line}</span>
                      <Badge className={getLabelStatusColor(label.label_status)}>
                        {label.label_status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm">{label.customer_name} — {label.part_number}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Qty: {label.order_qty.toLocaleString()}</span>
                      <span>{label.num_packages} pkg</span>
                    </div>
                    <div className="flex gap-1 pt-1">
                      <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); handleView(label) }}>
                        <Eye className="size-3 mr-1" /> View
                      </Button>
                      <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); handlePrint(label) }}>
                        <Printer className="size-3 mr-1" /> Print
                      </Button>
                    </div>
                  </div>
                )
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <LabelSettings />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <LabelPreviewModal
        label={previewLabel}
        open={showPreview}
        onOpenChange={setShowPreview}
        onPrint={handlePrint}
      />

      <GenerateLabelsDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        onGenerated={fetchLabels}
      />
    </div>
  )
}
