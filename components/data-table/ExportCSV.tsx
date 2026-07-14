'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportToCSV } from '@/lib/export-csv'
import { useI18n } from '@/lib/i18n'

interface ExportCSVProps<T extends Record<string, unknown>> {
  data: T[]
  columns: { key: keyof T & string; label: string }[]
  filename?: string
}

export function ExportCSV<T extends Record<string, unknown>>({
  data,
  columns,
  filename = 'export.csv',
}: ExportCSVProps<T>) {
  const { t } = useI18n()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => exportToCSV(data, columns, filename)}
      disabled={data.length === 0}
    >
      <Download className="size-4" />
      <span className="hidden sm:inline">{t('ui.export')}</span>
    </Button>
  )
}
