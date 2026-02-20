'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const updatePos = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.right })
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll/resize
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open) updatePos()
    setOpen(!open)
  }

  return (
    <>
      <Button
        ref={btnRef}
        variant="outline"
        size="sm"
        onClick={handleToggle}
        disabled={data.length === 0}
      >
        <Download className="size-4" />
        <span className="hidden sm:inline">Export</span>
      </Button>
      {open && pos && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg min-w-[140px] py-1"
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              exportToCSV(data, columns, filename)
              setOpen(false)
            }}
          >
            <FileText className="size-4" />
            CSV
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={async (e) => {
              e.stopPropagation()
              await exportToExcel(data, columns, filename)
              setOpen(false)
            }}
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
