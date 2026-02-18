'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportToCSV, exportToExcel } from '@/lib/export-utils'

interface ExportMenuProps<T extends Record<string, unknown>> {
  data: T[]
  columns: { key: keyof T & string; label: string }[]
  filename?: string
}

export function ExportMenu<T extends Record<string, unknown>>({
  data,
  columns,
  filename = 'export',
}: ExportMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={data.length === 0}
      >
        <Download className="size-4" />
        <span className="hidden sm:inline">Export</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-lg min-w-[140px] py-1">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={() => {
              exportToCSV(data, columns, filename)
              setOpen(false)
            }}
          >
            <FileText className="size-4" />
            CSV
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={async () => {
              await exportToExcel(data, columns, filename)
              setOpen(false)
            }}
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </button>
        </div>
      )}
    </div>
  )
}
