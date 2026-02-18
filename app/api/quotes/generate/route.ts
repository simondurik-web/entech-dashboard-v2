import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import React from 'react'
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { ENTECH_LOGO_BASE64 } from '@/lib/entech-logo'

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 9, color: '#333' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '3px solid #c82333', paddingBottom: 12, marginBottom: 16 },
  logo: { height: 40, width: 'auto' },
  logoText: { fontSize: 28, fontWeight: 'bold', color: '#c82333' },
  companyName: { fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase' },
  companyDetails: { fontSize: 8, color: '#555', textAlign: 'right' },
  title: { textAlign: 'center', fontSize: 16, color: '#999', textTransform: 'uppercase', letterSpacing: 2, marginVertical: 16 },
  infoGrid: { flexDirection: 'row', marginBottom: 20 },
  infoCell: { width: '25%' },
  label: { fontWeight: 'bold', fontSize: 7, color: '#666', textTransform: 'uppercase', marginBottom: 2 },
  value: { fontWeight: 'bold', fontSize: 10, color: '#000' },
  paymentTerms: { color: '#c82333' },
  repSection: { marginBottom: 24 },
  repHeader: { fontWeight: 'bold', color: '#c82333', textTransform: 'uppercase', fontSize: 9, marginBottom: 4 },
  sectionHeader: { fontWeight: 'bold', fontSize: 10, color: '#999', textTransform: 'uppercase', marginBottom: 8 },
  tableHeader: { flexDirection: 'row', borderBottom: '1px solid #ddd', paddingBottom: 4, marginBottom: 4 },
  tableHeaderText: { fontSize: 7, fontWeight: 'bold', color: '#999', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', borderBottom: '1px solid #eee', paddingVertical: 10 },
  itemCol: { width: '5%', color: '#c82333', fontWeight: 'bold' },
  partCol: { width: '20%', fontWeight: 'bold' },
  descCol: { width: '25%' },
  priceCol: { width: '35%', fontSize: 8 },
  totalCol: { width: '15%', textAlign: 'right', fontWeight: 'bold' },
  totalsBox: { width: '40%', marginLeft: 'auto', border: '2px solid #c82333', padding: 10, marginTop: 20 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  grandTotal: { fontSize: 12, fontWeight: 'bold', color: '#c82333', borderTop: '1px solid #ccc', paddingTop: 4, marginTop: 4 },
  termsSection: { marginTop: 32, borderTop: '2px solid #eee', paddingTop: 12 },
  termsTitle: { fontWeight: 'bold', textTransform: 'uppercase', fontSize: 9, marginBottom: 6 },
  termItem: { fontSize: 8, color: '#444', marginBottom: 3, paddingLeft: 12 },
  thankYou: { textAlign: 'center', marginTop: 24, color: '#666', fontSize: 9 },
  tierLine: { marginBottom: 2 },
})

interface QuoteItem {
  internalPartNumber: string
  customerPartNumber: string
  displayMode: 'tiers' | 'quantity'
  tiers: Array<{ min: number; price: number; rangeText: string }>
  quantity: number
  unitPrice: number
  total: number
}

interface QuoteRequest {
  customerName: string
  customerId: string
  paymentTerms: string
  notes: string
  items: QuoteItem[]
  totalAmount: number
}

function formatCurrency(n: number) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatDate(d: Date) {
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`
}

function QuotePDF({ data, quoteNumber, dateIssued, validUntil }: {
  data: QuoteRequest
  quoteNumber: string
  dateIssued: string
  validUntil: string
}) {
  return React.createElement(Document, {},
    React.createElement(Page, { size: 'LETTER', style: styles.page },
      // Header
      React.createElement(View, { style: styles.headerRow },
        React.createElement(View, {},
          ENTECH_LOGO_BASE64
            ? React.createElement(Image, { src: ENTECH_LOGO_BASE64, style: styles.logo })
            : React.createElement(Text, { style: styles.logoText }, 'entech')
        ),
        React.createElement(View, { style: { textAlign: 'right' } },
          React.createElement(Text, { style: styles.companyName }, 'ENTECH, INC.'),
          React.createElement(Text, { style: styles.companyDetails }, '10440 County Road 2'),
          React.createElement(Text, { style: styles.companyDetails }, 'Middlebury, IN 46540'),
          React.createElement(Text, { style: styles.companyDetails }, 'Phone: 574.822.9107'),
          React.createElement(Text, { style: styles.companyDetails }, 'www.4entech.com'),
        )
      ),
      // Title
      React.createElement(Text, { style: styles.title }, 'QUOTATION'),
      // Info grid
      React.createElement(View, { style: styles.infoGrid },
        React.createElement(View, { style: styles.infoCell },
          React.createElement(Text, { style: styles.label }, 'Quote Number'),
          React.createElement(Text, { style: styles.value }, quoteNumber),
        ),
        React.createElement(View, { style: styles.infoCell },
          React.createElement(Text, { style: styles.label }, 'Customer'),
          React.createElement(Text, { style: styles.value }, data.customerName),
        ),
        React.createElement(View, { style: styles.infoCell },
          React.createElement(Text, { style: styles.label }, 'Date Issued'),
          React.createElement(Text, { style: styles.value }, dateIssued),
        ),
        React.createElement(View, { style: styles.infoCell },
          React.createElement(Text, { style: styles.label }, 'Valid Until'),
          React.createElement(Text, { style: styles.value }, validUntil),
        ),
      ),
      // Payment terms row
      React.createElement(View, { style: { ...styles.infoGrid, marginBottom: 16 } },
        React.createElement(View, { style: styles.infoCell },
          React.createElement(Text, { style: styles.label }, 'Payment Terms'),
          React.createElement(Text, { style: { ...styles.value, ...styles.paymentTerms } }, data.paymentTerms || 'Net 30'),
        ),
        React.createElement(View, { style: styles.infoCell },
          React.createElement(Text, { style: styles.label }, 'Currency'),
          React.createElement(Text, { style: styles.value }, 'USD'),
        ),
      ),
      // Sales rep
      React.createElement(View, { style: styles.repSection },
        React.createElement(Text, { style: styles.repHeader }, 'YOUR SALES REPRESENTATIVE'),
        React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold' } }, 'Philip Habecker'),
        React.createElement(Text, { style: { fontSize: 9 } }, 'Direct: 574.358.0585 | Ext: 418'),
        React.createElement(Text, { style: { fontSize: 9 } }, 'Email: philip.habecker@4entech.com | RollTech.Sales@4entech.com'),
      ),
      // Items header
      React.createElement(Text, { style: styles.sectionHeader }, 'QUOTED ITEMS'),
      React.createElement(View, { style: styles.tableHeader },
        React.createElement(Text, { style: { ...styles.tableHeaderText, width: '5%' } }, 'Item'),
        React.createElement(Text, { style: { ...styles.tableHeaderText, width: '20%' } }, 'Customer P/N'),
        React.createElement(Text, { style: { ...styles.tableHeaderText, width: '25%' } }, 'Internal P/N'),
        React.createElement(Text, { style: { ...styles.tableHeaderText, width: '35%' } }, 'Pricing'),
        React.createElement(Text, { style: { ...styles.tableHeaderText, width: '15%', textAlign: 'right' } }, 'Line Total'),
      ),
      // Items
      ...data.items.map((item, idx) =>
        React.createElement(View, { key: idx, style: styles.itemRow, wrap: false },
          React.createElement(Text, { style: styles.itemCol }, String(idx + 1).padStart(3, '0')),
          React.createElement(Text, { style: styles.partCol }, item.customerPartNumber || '-'),
          React.createElement(Text, { style: styles.descCol }, item.internalPartNumber),
          React.createElement(View, { style: styles.priceCol },
            item.displayMode === 'tiers'
              ? item.tiers.map((t, ti) =>
                  React.createElement(Text, { key: ti, style: styles.tierLine },
                    `${t.rangeText} units: ${formatCurrency(t.price)}/ea`
                  )
                )
              : React.createElement(Text, {},
                  `Qty: ${item.quantity.toLocaleString()} @ ${formatCurrency(item.unitPrice)}/ea`
                )
          ),
          React.createElement(Text, { style: styles.totalCol },
            item.displayMode === 'quantity' ? formatCurrency(item.total) : ''
          ),
        )
      ),
      // Totals
      ...(data.totalAmount > 0
        ? [React.createElement(View, { key: 'totals', style: styles.totalsBox, wrap: false },
            React.createElement(View, { style: styles.totalRow },
              React.createElement(Text, { style: { fontWeight: 'bold', color: '#444' } }, 'Subtotal:'),
              React.createElement(Text, {}, formatCurrency(data.totalAmount)),
            ),
            React.createElement(View, { style: styles.totalRow },
              React.createElement(Text, { style: { fontWeight: 'bold', color: '#444' } }, 'Tax (0%):'),
              React.createElement(Text, {}, '$0.00'),
            ),
            React.createElement(View, { style: { ...styles.totalRow, ...styles.grandTotal } },
              React.createElement(Text, { style: { color: '#c82333' } }, 'TOTAL:'),
              React.createElement(Text, {}, formatCurrency(data.totalAmount)),
            ),
          )]
        : []),
      // Terms
      React.createElement(View, { style: styles.termsSection, wrap: false },
        React.createElement(Text, { style: styles.termsTitle }, 'TERMS & CONDITIONS'),
        React.createElement(Text, { style: styles.termItem }, `• Payment Terms: ${data.paymentTerms || 'Net 30'}`),
        React.createElement(Text, { style: styles.termItem }, '• Prices valid for 30 days from quote date'),
        React.createElement(Text, { style: styles.termItem }, '• Minimum order quantities may apply'),
        React.createElement(Text, { style: styles.termItem }, '• Shipping costs not included unless specified'),
        React.createElement(Text, { style: styles.termItem }, "• All sales subject to Entech's standard terms"),
      ),
      // Thank you
      React.createElement(View, { style: styles.thankYou },
        React.createElement(Text, { style: { fontWeight: 'bold' } }, 'entech'),
        React.createElement(Text, {}, 'Thank you for the opportunity.'),
      ),
    )
  )
}

async function generateQuoteNumber(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const prefix = `ENT-Q${year}${month}`

  const { data } = await supabaseAdmin
    .from('quotes')
    .select('quote_number')
    .like('quote_number', `${prefix}%`)
    .order('quote_number', { ascending: false })
    .limit(1)

  let nextNum = 1
  if (data && data.length > 0) {
    const parts = data[0].quote_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1])
    if (!isNaN(lastNum)) nextNum = lastNum + 1
  }

  return `${prefix}-${String(nextNum).padStart(4, '0')}`
}

export async function POST(request: Request) {
  try {
    const body: QuoteRequest = await request.json()

    if (!body.customerName || !body.items || body.items.length === 0) {
      return NextResponse.json({ error: 'Customer and items are required' }, { status: 400 })
    }

    const quoteNumber = await generateQuoteNumber()
    const createdDate = new Date()
    const validUntil = new Date(createdDate)
    validUntil.setDate(validUntil.getDate() + 30)

    const dateIssuedStr = formatDate(createdDate)
    const validUntilStr = formatDate(validUntil)

    // Generate PDF
    const pdfDoc = QuotePDF({
      data: body,
      quoteNumber,
      dateIssued: dateIssuedStr,
      validUntil: validUntilStr,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(pdfDoc as any)

    // Upload to Supabase Storage
    const safeName = body.customerName.replace(/[^a-zA-Z0-9]/g, '_')
    const storagePath = `${quoteNumber}_${safeName}.pdf`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('quote-pdfs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) throw uploadError

    const { data: urlData } = supabaseAdmin.storage
      .from('quote-pdfs')
      .getPublicUrl(storagePath)

    // Create quote record
    const { error: insertError } = await supabaseAdmin
      .from('quotes')
      .insert({
        quote_number: quoteNumber,
        customer: body.customerName,
        created_date: createdDate.toISOString(),
        valid_until: validUntil.toISOString(),
        amount: body.totalAmount || 0,
        sales_rep: 'Philip Habecker',
        quoted_items: body.items.length,
        notes: body.notes || null,
        payment_terms: body.paymentTerms || 'Net 30',
        status: 'draft',
        pdf_url: urlData.publicUrl,
        pdf_path: storagePath,
      })

    if (insertError) throw insertError

    return NextResponse.json({
      success: true,
      quoteNumber,
      pdfUrl: urlData.publicUrl,
    })
  } catch (err) {
    console.error('Failed to generate quote:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate quote' },
      { status: 500 }
    )
  }
}
