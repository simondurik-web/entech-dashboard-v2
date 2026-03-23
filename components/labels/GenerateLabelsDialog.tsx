'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'

interface OrderOption {
  line: string
  customer: string
  partNumber: string
  orderQty: number
}

interface GenerateLabelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: () => void
}

export function GenerateLabelsDialog({ open, onOpenChange, onGenerated }: GenerateLabelsDialogProps) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)

    // Fetch orders that don't have labels yet
    Promise.all([
      fetch('/api/sheets').then(r => r.json()),
      fetch('/api/labels').then(r => r.json()),
    ])
      .then(([allOrders, existingLabels]) => {
        const labeledLines = new Set(
          (existingLabels as Array<{ order_line: string }>).map((l) => l.order_line)
        )
        const available = (allOrders as Array<Record<string, unknown>>)
          .filter((o) => !labeledLines.has(String(o.line || '')))
          .filter((o) => {
            const status = String(o.internalStatus || o.internal_status || '').toLowerCase()
            return !status.includes('shipped') && !status.includes('cancel')
          })
          .map((o): OrderOption => ({
            line: String(o.line || ''),
            customer: String(o.customer || ''),
            partNumber: String(o.partNumber || o.part_number || ''),
            orderQty: Number(o.orderQty || o.order_qty || 0),
          }))
        setOrders(available)
        setSelected(new Set())
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  const filtered = orders.filter((o) => {
    if (!search) return true
    const s = search.toLowerCase()
    return o.line.toLowerCase().includes(s) ||
      o.customer.toLowerCase().includes(s) ||
      o.partNumber.toLowerCase().includes(s)
  })

  const toggleSelect = (line: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(o => o.line)))
  }

  const handleGenerate = async () => {
    if (selected.size === 0) return
    setGenerating(true)
    setError(null)

    try {
      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user ? { 'x-user-id': user.id } : {}),
        },
        body: JSON.stringify({ order_lines: Array.from(selected) }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate labels')
      }

      onGenerated()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t('labels.generateForOrder')}</DialogTitle>
        </DialogHeader>

        <Input
          placeholder={t('ui.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
        />

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        )}

        {error && <p className="text-sm text-destructive py-2">{error}</p>}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('labels.noOrdersAvailable')}
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <div className="max-h-[40vh] overflow-y-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left w-8">
                    <Checkbox
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">{t('table.line')}</th>
                  <th className="px-3 py-2 text-left">{t('table.customer')}</th>
                  <th className="px-3 py-2 text-left">{t('table.partNumber')}</th>
                  <th className="px-3 py-2 text-right">{t('table.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.line}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggleSelect(o.line)}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(o.line)}
                        onCheckedChange={() => toggleSelect(o.line)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">{o.line}</td>
                    <td className="px-3 py-2">{o.customer}</td>
                    <td className="px-3 py-2">{o.partNumber}</td>
                    <td className="px-3 py-2 text-right">{o.orderQty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('ui.cancel')}
          </Button>
          <Button onClick={handleGenerate} disabled={selected.size === 0 || generating}>
            {generating ? t('labels.generating') : `${t('labels.generateLabels')} (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
