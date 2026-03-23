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
      <DialogContent className="max-w-[480px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            {t('labels.preview')}
            <Badge className={getLabelStatusColor(label.label_status)}>
              {label.label_status.toUpperCase()}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* ===== PALLET LABEL — exact match to Google Sheets template ===== */}
        <div
          id="label-print-area"
          className="bg-white text-black dark:bg-white dark:text-black"
          style={{
            fontFamily: "'Calibri', 'Segoe UI', sans-serif",
            border: '3px solid black',
            width: '100%',
            maxWidth: '420px',
            margin: '0 auto',
          }}
        >
          {/* === HEADER: QR Code + Line Number === */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '100px 1fr 1fr',
              alignItems: 'center',
              borderBottom: '2px solid black',
              padding: '10px 12px',
              minHeight: '90px',
            }}
          >
            {/* QR Code — top left */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {label.qr_data ? (
                <QRCodeSVG value={label.qr_data} size={80} level="M" />
              ) : (
                <div style={{ width: 80, height: 80, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#999' }}>
                  No QR
                </div>
              )}
            </div>

            {/* Line Number label */}
            <div style={{ fontSize: '18px', fontWeight: 'bold', paddingLeft: '8px' }}>
              Line Number:
            </div>

            {/* Line Number value — largest element */}
            <div style={{ fontSize: '28px', fontWeight: 'bold', textAlign: 'center' }}>
              {label.order_line}
            </div>
          </div>

          {/* === BODY: Field rows === */}
          <div style={{ padding: '4px 16px 8px' }}>
            {/* Customer */}
            <LabelRow label="Customer:" value={label.customer_name} />

            {/* Part Number */}
            <LabelRow label="Part Number:" value={label.part_number} />

            {/* Order Quantity */}
            <LabelRow label="Order Quantity:" value={label.order_qty?.toLocaleString()} />

            {/* Tire */}
            <LabelRow label="Tire:" value={label.tire || '—'} />

            {/* Hub */}
            <LabelRow label="Hub:" value={label.hub || '—'} />

            {/* Hub Style */}
            <LabelRow label="Hub Style:" value={label.hub_style || '—'} />

            {/* Bearings */}
            <LabelRow label="Bearings:" value={label.bearings || '—'} />

            {/* PO Number */}
            <LabelRow label="PO Number:" value={label.po_number || '—'} />

            {/* IF# */}
            <LabelRow label="IF#" value={label.if_number || '—'} />

            {/* Parts per Package */}
            <LabelRow label="Parts per Package:" value={label.parts_per_package?.toLocaleString()} />

            {/* Package number */}
            <LabelRow label="Package number:" value={`of ${label.num_packages}`} />

            {/* Type of packaging */}
            <LabelRow label="Type of packaging" value={label.packaging_type || '—'} />

            {/* Carefully Packaged by — blank for handwriting */}
            <LabelRow label="Carefully Packaged by 🤗 :" value="" writeable />

            {/* Date — with slash placeholders */}
            <LabelRow label="Date:" value="       /       /       " writeable />

            {/* Spacer before Weight/Dimension */}
            <div style={{ height: '8px' }} />

            {/* Weight — blank for handwriting */}
            <LabelRow label="Weight:" value="" writeable />

            {/* Dimension — with slash placeholders */}
            <LabelRow label="Dimension:" value="       /       /       " writeable />
          </div>
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

      {/* Print styles — only the label prints */}
      <style jsx global>{`
        @media print {
          body > *:not([data-slot="dialog-overlay"]) { display: none !important; }
          [data-slot="dialog-overlay"] { position: static !important; background: none !important; }
          [data-slot="dialog-content"] {
            position: static !important;
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            padding: 0 !important;
            background: none !important;
          }
          [data-slot="dialog-content"] > *:not(#label-print-area) { display: none !important; }
          #label-print-area {
            display: block !important;
            border: 3px solid black !important;
            background: white !important;
            color: black !important;
            width: 4in !important;
            max-width: 4in !important;
            margin: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </Dialog>
  )
}

/* === Label field row component — matches the two-column Google Sheets layout === */
function LabelRow({ label, value, writeable }: { label: string; value?: string; writeable?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '2px 0',
        fontSize: '13px',
        lineHeight: '1.7',
      }}
    >
      <span style={{ flex: '0 0 48%', textAlign: 'left' }}>{label}</span>
      <span
        style={{
          flex: '0 0 52%',
          textAlign: 'center',
          borderBottom: writeable ? '1px solid #999' : undefined,
          minHeight: writeable ? '20px' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  )
}
