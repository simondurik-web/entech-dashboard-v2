'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Printer, Mail, ChevronLeft, ChevronRight } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useI18n } from '@/lib/i18n'
import type { LabelData } from '@/lib/label-utils'
import { getLabelStatusColor } from '@/lib/label-utils'

interface LabelPreviewModalProps {
  label: LabelData | null
  /** All labels for the same order line — used for "Print All" */
  siblingLabels?: LabelData[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPrint?: (label: LabelData) => void
  onEmail?: (label: LabelData) => void
}

export function LabelPreviewModal({ label, siblingLabels, open, onOpenChange, onPrint, onEmail }: LabelPreviewModalProps) {
  const { t } = useI18n()

  const [currentIdx, setCurrentIdx] = useState(0)

  if (!label) return null

  // All labels to print — if siblings exist, print all; otherwise just the current one
  const labelsToPrint = siblingLabels && siblingLabels.length > 1 ? siblingLabels : [label]
  const currentLabel = labelsToPrint[currentIdx] || label

  const handlePrint = () => {
    let printRoot = document.getElementById('label-print-root')
    if (!printRoot) {
      printRoot = document.createElement('div')
      printRoot.id = 'label-print-root'
      document.body.appendChild(printRoot)
    }
    printRoot.innerHTML = ''

    // Render ALL labels (one per page) into the print root
    for (let i = 0; i < labelsToPrint.length; i++) {
      const source = document.getElementById(`label-print-area-${i}`)
      if (!source) continue
      const clone = source.cloneNode(true) as HTMLElement
      clone.className = 'label-print-page'
      clone.style.maxWidth = 'none'
      clone.style.width = '100%'
      clone.style.margin = '0'
      if (i < labelsToPrint.length - 1) {
        clone.style.pageBreakAfter = 'always'
      }
      printRoot.appendChild(clone)
    }

    // Fallback: if no indexed elements found, try the single label-print-area
    if (printRoot.children.length === 0) {
      const source = document.getElementById('label-print-area')
      if (source) {
        const clone = source.cloneNode(true) as HTMLElement
        clone.className = 'label-print-page'
        clone.style.maxWidth = 'none'
        clone.style.width = '100%'
        clone.style.margin = '0'
        printRoot.appendChild(clone)
      }
    }

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
            <div className="flex items-center gap-2">
              {t('labels.preview')}
              {labelsToPrint.length > 1 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({currentIdx + 1} of {labelsToPrint.length})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {labelsToPrint.length > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => i - 1)}>
                    <ChevronLeft className="size-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={currentIdx === labelsToPrint.length - 1} onClick={() => setCurrentIdx(i => i + 1)}>
                    <ChevronRight className="size-3" />
                  </Button>
                </div>
              )}
              <Badge className={getLabelStatusColor(label.label_status)}>
                {label.label_status.toUpperCase()}
              </Badge>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* ===== Visible preview — shows current label ===== */}
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
              {currentLabel.qr_data ? (
                <QRCodeSVG value={currentLabel.qr_data} size={80} level="M" />
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
              {currentLabel.order_line}
            </div>
          </div>

          {/* === BODY: Field rows === */}
          <div data-label-body style={{ padding: '4px 16px 8px' }}>
            {/* Customer */}
            <LabelRow label="Customer:" value={currentLabel.customer_name} />

            {/* Part Number */}
            <LabelRow label="Part Number:" value={currentLabel.part_number} />

            {/* Order Quantity */}
            <LabelRow label="Order Quantity:" value={currentLabel.order_qty?.toLocaleString()} />

            {/* Tire */}
            <LabelRow label="Tire:" value={currentLabel.tire || '—'} />

            {/* Hub */}
            <LabelRow label="Hub:" value={currentLabel.hub || '—'} />

            {/* Hub Style */}
            <LabelRow label="Hub Style:" value={currentLabel.hub_style || '—'} />

            {/* Bearings */}
            <LabelRow label="Bearings:" value={currentLabel.bearings || '—'} />

            {/* PO Number */}
            <LabelRow label="PO Number:" value={currentLabel.po_number || '—'} />

            {/* IF# */}
            <LabelRow label="IF#" value={currentLabel.if_number || '—'} />

            {/* Parts per Package */}
            <LabelRow label="Parts per Package:" value={currentLabel.parts_per_package?.toLocaleString()} />

            {/* Package number — pre-filled with pallet_number if available */}
            <LabelRow label="Package number:" value={currentLabel.pallet_number ? `${currentLabel.pallet_number} of ${currentLabel.num_packages}` : `of ${currentLabel.num_packages}`} />

            {/* Type of packaging */}
            <LabelRow label="Type of packaging" value={currentLabel.packaging_type || '—'} />

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

        {/* Hidden label copies for multi-page printing */}
        {labelsToPrint.length > 1 && (
          <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
            {labelsToPrint.map((lb, i) => (
              <div
                key={i}
                id={`label-print-area-${i}`}
                className="bg-white text-black"
                style={{
                  fontFamily: "'Calibri', 'Segoe UI', sans-serif",
                  border: '3px solid black',
                  width: '100%',
                }}
              >
                <div data-label-header style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', alignItems: 'center', borderBottom: '2px solid black', padding: '10px 12px', minHeight: '90px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {lb.qr_data ? <QRCodeSVG value={lb.qr_data} size={80} level="M" /> : <div style={{ width: 80, height: 80 }} />}
                  </div>
                  <div data-line-label style={{ fontSize: '18px', fontWeight: 'bold', paddingLeft: '8px' }}>Line Number:</div>
                  <div data-line-value style={{ fontSize: '28px', fontWeight: 'bold', textAlign: 'center' }}>{lb.order_line}</div>
                </div>
                <div data-label-body style={{ padding: '4px 16px 8px' }}>
                  <LabelRow label="Customer:" value={lb.customer_name} />
                  <LabelRow label="Part Number:" value={lb.part_number} />
                  <LabelRow label="Order Quantity:" value={lb.order_qty?.toLocaleString()} />
                  <LabelRow label="Tire:" value={lb.tire || '—'} />
                  <LabelRow label="Hub:" value={lb.hub || '—'} />
                  <LabelRow label="Hub Style:" value={lb.hub_style || '—'} />
                  <LabelRow label="Bearings:" value={lb.bearings || '—'} />
                  <LabelRow label="PO Number:" value={lb.po_number || '—'} />
                  <LabelRow label="IF#" value={lb.if_number || '—'} />
                  <LabelRow label="Parts per Package:" value={lb.parts_per_package?.toLocaleString()} />
                  <LabelRow label="Package number:" value={lb.pallet_number ? `${lb.pallet_number} of ${lb.num_packages}` : `of ${lb.num_packages}`} />
                  <LabelRow label="Type of packaging" value={lb.packaging_type || '—'} />
                  <LabelRow label="Carefully Packaged by 🤗 :" value="" writeable />
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
                  <div style={{ height: '8px' }} />
                  <LabelRow label="Weight:" value="" writeable />
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
            ))}
          </div>
        )}

        {/* Audit info — shown below the label, not printed */}
        {(label.printed_by_name || label.printed_at) && (
          <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2" data-no-print>
            <Printer className="size-3.5" />
            <span>
              Printed by <span className="font-medium text-foreground">{label.printed_by_name || 'Unknown'}</span>
              {label.printed_at && (
                <> on {new Date(label.printed_at).toLocaleString()}</>
              )}
            </span>
          </div>
        )}

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
            {labelsToPrint.length > 1 ? `Print All (${labelsToPrint.length})` : t('labels.print')}
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
          /* Each label page — fills the full page */
          .label-print-page + .label-print-page {
            page-break-before: always !important;
            break-before: page !important;
          }
          .label-print-page, #label-print-clone {
            position: relative !important;
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
          .label-print-page [data-label-header] {
            display: grid !important;
            grid-template-columns: 130px 1fr 1fr !important;
            align-items: center !important;
            padding: 12px 24px !important;
            min-height: 100px !important;
            border-bottom: 2px solid black !important;
          }
          .label-print-page [data-label-header] svg {
            width: 110px !important;
            height: 110px !important;
          }
          .label-print-page [data-line-label] {
            font-size: 22px !important;
            font-weight: bold !important;
          }
          .label-print-page [data-line-value] {
            font-size: 52px !important;
            font-weight: bold !important;
            text-align: center !important;
          }
          .label-print-page [data-label-body] {
            padding: 6px 36px 8px !important;
          }
          .label-print-page [data-label-row] {
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
      <span style={{ flex: writeable ? '0 0 30%' : '0 0 48%', textAlign: 'left' }}>{label}</span>
      <span
        style={{
          flex: writeable ? '0 0 70%' : '0 0 52%',
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
