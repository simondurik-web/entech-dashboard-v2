'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Printer, Mail } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useI18n } from '@/lib/i18n'
import type { LabelData } from '@/lib/label-utils'
import { getLabelStatusColor } from '@/lib/label-utils'

interface LabelPreviewModalProps {
  label: LabelData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPrint?: (label: LabelData) => void
  onEmail?: (label: LabelData) => void
}

export function LabelPreviewModal({ label, open, onOpenChange, onPrint, onEmail }: LabelPreviewModalProps) {
  const { t } = useI18n()

  if (!label) return null

  const handlePrint = () => {
    if (onPrint) onPrint(label)
    else window.print()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('labels.preview')}</DialogTitle>
        </DialogHeader>

        {/* Printable label area */}
        <div id="label-print-area" className="border-2 border-dashed rounded-lg p-6 space-y-4 bg-white text-black dark:bg-white">
          {/* Header */}
          <div className="text-center border-b-2 border-black pb-3">
            <h2 className="text-lg font-bold tracking-wider">{t('labels.palletLabel')}</h2>
            <p className="text-xs text-gray-500 mt-1">Entech Molding</p>
          </div>

          {/* Customer + Part */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase text-gray-500 font-medium">{t('table.customer')}</p>
              <p className="text-sm font-bold">{label.customer_name}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500 font-medium">{t('table.partNumber')}</p>
              <p className="text-sm font-bold">{label.part_number}</p>
            </div>
          </div>

          {/* Quantities */}
          <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-md p-3">
            <div className="text-center">
              <p className="text-[10px] uppercase text-gray-500">{t('labels.orderQty')}</p>
              <p className="text-lg font-bold">{label.order_qty.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase text-gray-500">{t('labels.partsInPackage')}</p>
              <p className="text-lg font-bold">{label.parts_per_package.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase text-gray-500">{t('table.packages')}</p>
              <p className="text-lg font-bold">{label.num_packages}</p>
            </div>
          </div>

          {/* QR Code + Line */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] uppercase text-gray-500">{t('table.line')}</p>
              <p className="text-sm font-bold">{label.order_line}</p>
              {label.packaging_type && (
                <>
                  <p className="text-[10px] uppercase text-gray-500 mt-2">{t('table.packaging')}</p>
                  <p className="text-sm">{label.packaging_type}</p>
                </>
              )}
              {label.generated_at && (
                <>
                  <p className="text-[10px] uppercase text-gray-500 mt-2">{t('labels.generatedAt')}</p>
                  <p className="text-xs">{new Date(label.generated_at).toLocaleDateString()}</p>
                </>
              )}
            </div>
            {label.qr_data && (
              <div className="shrink-0">
                <QRCodeSVG value={label.qr_data} size={96} level="M" />
              </div>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('labels.status')}:</span>
          <Badge className={getLabelStatusColor(label.label_status)}>
            {label.label_status.toUpperCase()}
          </Badge>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('ui.close')}
          </Button>
          {onEmail && (
            <Button variant="outline" onClick={() => onEmail(label)}>
              <Mail className="size-4 mr-1" />
              {t('labels.email')}
            </Button>
          )}
          <Button onClick={handlePrint}>
            <Printer className="size-4 mr-1" />
            {t('labels.print')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body > *:not([data-slot="dialog-overlay"]) { display: none !important; }
          [data-slot="dialog-overlay"] { position: static !important; }
          [data-slot="dialog-content"] {
            position: static !important;
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            padding: 0 !important;
          }
          #label-print-area {
            border: 2px solid black !important;
            background: white !important;
            color: black !important;
          }
          [data-slot="dialog-content"] > *:not(#label-print-area) { display: none !important; }
          #label-print-area { display: block !important; }
        }
      `}</style>
    </Dialog>
  )
}
