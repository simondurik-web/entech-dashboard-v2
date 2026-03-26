'use client'

import { QRCodeSVG } from 'qrcode.react'

const sampleLabel = {
  order_line: '2918',
  customer_name: 'RK HydroVac Inc',
  part_number: '648.208.1930',
  order_qty: 45,
  parts_per_package: 45,
  num_packages: 1,
  packaging_type: 'Pallet',
  tire: '208',
  hub: 'H48.100.3557G',
  hub_style: 'VSP',
  bearings: 'FBB-193510',
  po_number: '24605',
  if_number: 'IF152612',
  qr_data: 'LINE:2918|CUST:RK HydroVac Inc|PART:648.208.1930|QTY:45|PKG:1of1',
}

function LabelRow({ label, value, writeable, bold }: { label: string; value?: string; writeable?: boolean; bold?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '6px 0',
        fontSize: '18px',
        lineHeight: '1.8',
        fontWeight: bold ? 'bold' : 'normal',
      }}
    >
      <span style={{ flex: '0 0 50%', textAlign: 'left' }}>{label}</span>
      <span
        style={{
          flex: '0 0 50%',
          textAlign: 'center',
          borderBottom: writeable ? '1.5px solid #999' : undefined,
          minHeight: writeable ? '28px' : undefined,
          fontWeight: bold ? 'bold' : 'normal',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export default function LabelPreviewTest() {
  const l = sampleLabel
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'white',
        margin: 0,
        padding: 0,
      }}
    >
      {/* Full-page label — sized for 8.5x11 print */}
      <div
        style={{
          fontFamily: "'Calibri', 'Segoe UI', Arial, sans-serif",
          border: '4px solid black',
          width: '7.5in',
          minHeight: '9.5in',
          background: 'white',
          color: 'black',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* HEADER: QR + Line Number */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr',
            alignItems: 'center',
            borderBottom: '3px solid black',
            padding: '24px 32px',
            minHeight: '160px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <QRCodeSVG value={l.qr_data} size={140} level="M" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
              Line Number:
            </div>
            <div style={{ fontSize: '64px', fontWeight: 'bold', lineHeight: 1 }}>
              {l.order_line}
            </div>
          </div>
        </div>

        {/* BODY — fills remaining space */}
        <div style={{ padding: '16px 40px 24px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <LabelRow label="Customer:" value={l.customer_name} bold />
            <LabelRow label="Part Number:" value={l.part_number} bold />
            <LabelRow label="Order Quantity:" value={String(l.order_qty)} />
            <LabelRow label="Tire:" value={l.tire} />
            <LabelRow label="Hub:" value={l.hub} />
            <LabelRow label="Hub Style:" value={l.hub_style} />
            <LabelRow label="Bearings:" value={l.bearings} />
            <LabelRow label="PO Number:" value={l.po_number} />
            <LabelRow label="IF#:" value={l.if_number} />

            <div style={{ borderTop: '2px solid black', margin: '16px 0' }} />

            <LabelRow label="Parts per Package:" value={String(l.parts_per_package)} bold />
            <LabelRow label="Package number:" value={`___ of ${l.num_packages}`} bold />
            <LabelRow label="Type of packaging:" value={l.packaging_type} />
          </div>

          <div>
            <div style={{ borderTop: '2px solid black', margin: '16px 0' }} />
            <LabelRow label="Carefully Packaged by 🤗 :" value="" writeable />
            <LabelRow label="Date:" value="       /       /       " writeable />
            <div style={{ height: '12px' }} />
            <LabelRow label="Weight:" value="" writeable />
            <LabelRow label="Dimension:" value="       /       /       " writeable />
          </div>
        </div>
      </div>
    </div>
  )
}
