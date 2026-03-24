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
    // Mark as printed via callback
    if (onPrint) onPrint(label)

    // Clone the label into a root-level container so it's outside the Radix portal
    const source = document.getElementById('label-print-area')
    if (!source) return

    let printRoot = document.getElementById('label-print-root')
    if (!printRoot) {
      printRoot = document.createElement('div')
      printRoot.id = 'label-print-root'
      document.body.appendChild(printRoot)
    }
    printRoot.innerHTML = ''
    const clone = source.cloneNode(true) as HTMLElement
    clone.id = 'label-print-clone'
    // Remove inline max-width/width so print CSS can take over
    clone.style.maxWidth = 'none'
    clone.style.width = '100%'
    clone.style.margin = '0'
    printRoot.appendChild(clone)

    setTimeout(() => {
      window.print()
      setTimeout(() => { if (printRoot) printRoot.innerHTML = '' }, 1000)
    }, 300)
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
            data-label-header
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
            <div data-line-label style={{ fontSize: '18px', fontWeight: 'bold', paddingLeft: '8px' }}>
              Line Number:
            </div>

            {/* Line Number value — largest element */}
            <div data-line-value style={{ fontSize: '28px', fontWeight: 'bold', textAlign: 'center' }}>
              {label.order_line}
            </div>
          </div>

          {/* === BODY: Field rows === */}
          <div data-label-body style={{ padding: '4px 16px 8px' }}>
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

            {/* Date — 3 equal sections for MM / DD / YYYY with wide spacing */}
            <div data-label-row style={{ display: 'flex', alignItems: 'baseline', padding: '2px 0', fontSize: '13px', lineHeight: '1.7' }}>
              <span style={{ flex: '0 0 30%', textAlign: 'left' }}>Date:</span>
              <span style={{ flex: '0 0 70%', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                <span style={{ flex: 1, borderBottom: '1px solid #999', textAlign: 'center', minHeight: '20px' }}>&nbsp;</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>/</span>
                <span style={{ flex: 1, borderBottom: '1px solid #999', textAlign: 'center', minHeight: '20px' }}>&nbsp;</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>/</span>
                <span style={{ flex: 1, borderBottom: '1px solid #999', textAlign: 'center', minHeight: '20px' }}>&nbsp;</span>
              </span>
            </div>

            {/* Spacer before Weight/Dimension */}
            <div style={{ height: '8px' }} />

            {/* Weight — blank for handwriting */}
            <LabelRow label="Weight:" value="" writeable />

            {/* Dimension — 3 equal sections for L / W / H with wide spacing */}
            <div data-label-row style={{ display: 'flex', alignItems: 'baseline', padding: '2px 0', fontSize: '13px', lineHeight: '1.7' }}>
              <span style={{ flex: '0 0 30%', textAlign: 'left' }}>Dimension:</span>
              <span style={{ flex: '0 0 70%', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                <span style={{ flex: 1, borderBottom: '1px solid #999', textAlign: 'center', minHeight: '20px' }}>&nbsp;</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>/</span>
                <span style={{ flex: 1, borderBottom: '1px solid #999', textAlign: 'center', minHeight: '20px' }}>&nbsp;</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>/</span>
                <span style={{ flex: 1, borderBottom: '1px solid #999', textAlign: 'center', minHeight: '20px' }}>&nbsp;</span>
              </span>
            </div>
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

      {/* Print styles — injected as plain <style> so it works in App Router */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: letter landscape; margin: 0; }
          /* Hide everything except the print root */
          body > *:not(#label-print-root) { display: none !important; visibility: hidden !important; }
          html, body {
            margin: 0 !important; padding: 0 !important;
            background: white !important; width: 100% !important; height: 100% !important;
          }
          #label-print-root {
            display: block !important; visibility: visible !important;
            width: 100% !important; height: 100% !important;
            margin: 0 !important; padding: 0 !important;
          }
          #label-print-root * { visibility: visible !important; }
          /* The cloned label — fills the full page */
          #label-print-clone {
            position: absolute !important;
            left: 0.3in !important;
            top: 0.2in !important;
            width: 9.4in !important;
            max-width: none !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            border: 3px solid black !important;
            background: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: 'Calibri', 'Segoe UI', sans-serif !important;
          }
          #label-print-clone [data-label-header] {
            display: grid !important;
            grid-template-columns: 130px 1fr 1fr !important;
            align-items: center !important;
            padding: 12px 24px !important;
            min-height: 100px !important;
            border-bottom: 2px solid black !important;
          }
          #label-print-clone [data-label-header] svg {
            width: 110px !important;
            height: 110px !important;
          }
          #label-print-clone [data-line-label] {
            font-size: 22px !important;
            font-weight: bold !important;
          }
          #label-print-clone [data-line-value] {
            font-size: 52px !important;
            font-weight: bold !important;
            text-align: center !important;
          }
          #label-print-clone [data-label-body] {
            padding: 6px 36px 8px !important;
          }
          #label-print-clone [data-label-row] {
            display: flex !important;
            justify-content: space-between !important;
            padding: 1px 0 !important;
            font-size: 16px !important;
            line-height: 1.4 !important;
          }
        }
      `}} />
    </Dialog>
  )
}

/* === Label field row component — matches the two-column Google Sheets layout === */
function LabelRow({ label, value, writeable }: { label: string; value?: string; writeable?: boolean }) {
  return (
    <div
      data-label-row
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
