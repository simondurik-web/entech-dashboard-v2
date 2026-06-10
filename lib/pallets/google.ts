import 'server-only'

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'
import { MAIN_SPREADSHEET_ID } from '@/lib/google-sheets-config'

const SHEETS_WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const DEFAULT_SECRET_PATH = path.resolve(process.cwd(), '..', '..', 'secrets', 'google-service-account.json')

let cachedWriteAuth: InstanceType<typeof google.auth.GoogleAuth> | null = null

type ServiceAccountCredentials = {
  client_email: string
  private_key: string
  project_id?: string
}

export type PalletOrder = {
  id: string
  line_number: string
  category: string
  if_number: string
  status: 'pending' | 'wip' | 'completed'
  status_raw: string
  po_number: string
  customer: string
  part_number: string
  order_qty: number
  num_pallets: number
}

function validateCredentials(credentials: unknown, sourceEnv: string): ServiceAccountCredentials {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error(`${sourceEnv} must decode to a Google service account JSON object.`)
  }

  const parsed = credentials as Record<string, unknown>
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : ''
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n').trim() : ''

  if (!clientEmail) throw new Error(`${sourceEnv} is missing required field: client_email`)
  if (!privateKey) throw new Error(`${sourceEnv} is missing required field: private_key`)

  return {
    ...parsed,
    client_email: clientEmail,
    private_key: privateKey,
  } as ServiceAccountCredentials
}

function parseBase64Credentials(encoded: string) {
  return validateCredentials(
    JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
    'GOOGLE_SERVICE_ACCOUNT_BASE64'
  )
}

function parseJsonCredentials(raw: string) {
  return validateCredentials(JSON.parse(raw), 'GOOGLE_SERVICE_ACCOUNT_JSON')
}

function parseJsonFileCredentials(filePath: string) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  if (!existsSync(resolvedPath)) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON_PATH points to a missing file: ${resolvedPath}`)
  }
  return validateCredentials(JSON.parse(readFileSync(resolvedPath, 'utf8')), 'GOOGLE_SERVICE_ACCOUNT_JSON_PATH')
}

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) return parseBase64Credentials(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return parseJsonCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) return parseJsonFileCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH)
  if (existsSync(DEFAULT_SECRET_PATH)) return parseJsonFileCredentials(DEFAULT_SECRET_PATH)
  throw new Error(
    `Google Sheets credentials not found. Set GOOGLE_SERVICE_ACCOUNT_BASE64, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_JSON_PATH, or place a service account at ${DEFAULT_SECRET_PATH}.`
  )
}

function getGoogleWriteAuth() {
  if (cachedWriteAuth) return cachedWriteAuth
  cachedWriteAuth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: [SHEETS_WRITE_SCOPE],
  })
  return cachedWriteAuth
}

export function getPalletSheets() {
  return google.sheets({ version: 'v4', auth: getGoogleWriteAuth() })
}

export const SHEET_ID = MAIN_SPREADSHEET_ID

export function sanitizeCell<T>(value: T): T | string {
  if (typeof value === 'string' && /^[=+\-@]/.test(value.trim())) {
    return `'${value}`
  }
  return value
}

export async function getOrders(includeCompleted = false): Promise<PalletOrder[]> {
  const sheets = getPalletSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Main Data!A:Z',
  })

  const rows = res.data.values
  if (!rows || rows.length < 2) return []

  return rows.slice(1)
    .map((row, idx) => {
      const statusRaw = (row[7] || '').trim()
      const statusLower = statusRaw.toLowerCase()
      const status = statusLower === 'completed'
        ? 'completed'
        : statusLower === 'work in progress'
          ? 'wip'
          : 'pending'
      return {
        id: `sheet-${idx}`,
        line_number: row[0] || '',
        category: row[1] || '',
        if_number: row[5] || '',
        status,
        status_raw: statusRaw,
        po_number: row[8] || '',
        customer: row[9] || '',
        part_number: row[11] || '',
        order_qty: parseInt(row[15], 10) || 0,
        num_pallets: parseInt(row[18], 10) || 0,
      } satisfies PalletOrder
    })
    .filter((o) => {
      if (!o.if_number) return false
      const s = o.status_raw.toLowerCase()
      if (s === '' || s === 'pending' || s === 'work in progress') return true
      if (includeCompleted && s === 'completed') return true
      return false
    })
}

export async function getCustomerByLine(lineNumber: string): Promise<string> {
  try {
    const sheets = getPalletSheets()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Main Data!A:J',
    })
    const rows = res.data.values || []
    const row = rows.find((r) => String(r[0]) === String(lineNumber))
    return row?.[9] || ''
  } catch (error) {
    console.error('Customer lookup error:', error)
    return ''
  }
}

export async function appendPalletRecord(args: {
  now: string
  line_number: string
  pallet_number: number
  weight: string | number | null
  parts_per_pallet: string | number | null
  length: string | number | null
  width: string | number | null
  height: string | number | null
  photo_urls: string[]
  recorded_by: string | null
  recorded_by_name: string | null
  customer: string
  internal_status?: string
}) {
  const sheets = getPalletSheets()
  const photos = args.photo_urls || []
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'App Pallet Records!A:Q',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        args.now,
        sanitizeCell(args.line_number),
        args.pallet_number,
        args.weight || '',
        args.parts_per_pallet || '',
        args.length || '',
        args.width || '',
        args.height || '',
        sanitizeCell(photos[0] || ''),
        sanitizeCell(photos[1] || ''),
        sanitizeCell(photos[2] || ''),
        sanitizeCell(photos[3] || ''),
        sanitizeCell(args.recorded_by_name || args.recorded_by || ''),
        '',
        '',
        sanitizeCell(args.internal_status || 'Work in Progress'),
        sanitizeCell(args.customer),
      ]],
    },
  })
}

export async function updatePalletRecordInSheet(args: {
  now: string
  line_number: string
  pallet_number: number
  weight: string | number | null
  parts_per_pallet: string | number | null
  length: string | number | null
  width: string | number | null
  height: string | number | null
  photo_urls: string[]
  edited_by: string | null
  edited_by_name: string | null
}) {
  const sheets = getPalletSheets()
  const sheetData = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'App Pallet Records!A:Q',
  })
  const rows = sheetData.data.values || []
  const rowIdx = rows.findIndex((r, i) =>
    i > 0 &&
    r[1] === args.line_number &&
    String(r[2]) === String(args.pallet_number) &&
    (r[15] || '') !== 'DELETED'
  )
  if (rowIdx <= 0) return

  const photos = args.photo_urls || []
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `App Pallet Records!A${rowIdx + 1}:Q${rowIdx + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        rows[rowIdx][0],
        sanitizeCell(args.line_number),
        args.pallet_number,
        args.weight || '',
        args.parts_per_pallet || '',
        args.length || '',
        args.width || '',
        args.height || '',
        sanitizeCell(photos[0] || ''),
        sanitizeCell(photos[1] || ''),
        sanitizeCell(photos[2] || ''),
        sanitizeCell(photos[3] || ''),
        sanitizeCell(rows[rowIdx][12] || ''),
        sanitizeCell(args.edited_by_name || args.edited_by || ''),
        args.now,
        sanitizeCell(rows[rowIdx][15] || 'Work in Progress'),
        sanitizeCell(rows[rowIdx][16] || ''),
      ]],
    },
  })
}

export async function markPalletDeletedInSheet(args: {
  now: string
  line_number: string
  pallet_number: number
  deleted_by: string | null
  deleted_by_name: string | null
}) {
  const sheets = getPalletSheets()
  const sheetData = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'App Pallet Records!A:Q',
  })
  const rows = sheetData.data.values || []
  const matchingRows: number[] = []
  rows.forEach((r, i) => {
    if (
      i > 0 &&
      r[1] === args.line_number &&
      String(r[2]) === String(args.pallet_number) &&
      (r[15] || '') !== 'DELETED'
    ) {
      matchingRows.push(i)
    }
  })
  for (const rowIdx of matchingRows) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `App Pallet Records!A${rowIdx + 1}:P${rowIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
        args.now,
        sanitizeCell(args.line_number),
        args.pallet_number,
        '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          sanitizeCell(args.deleted_by_name || args.deleted_by || ''),
          '',
          args.now,
          'DELETED',
        ]],
      },
    })
  }
}

export async function revertMainDataStatusAfterPalletDelete(lineNumber: string, remainingPallets: number) {
  const sheets = getPalletSheets()
  const mainData = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Main Data!A:S',
  })
  const mainRows = mainData.data.values || []
  const orderRowIdx = mainRows.findIndex((r, i) => i > 0 && r[0] === lineNumber)
  if (orderRowIdx <= 0) return

  const orderRow = mainRows[orderRowIdx]
  const requiredPallets = parseInt(orderRow[18], 10) || 0
  const currentStatus = (orderRow[7] || '').trim()
  const autoRevertable = currentStatus === 'Completed' || currentStatus === 'Staged'

  if (autoRevertable && remainingPallets < requiredPallets) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Main Data!H${orderRowIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Work in Progress']] },
    })
  }
}

export async function appendShippingRecord(args: {
  now: string
  system_type: string
  order_id: string
  carrier: string
  customer: string
  shipment_photos: string[]
  paperwork_photos: string[]
  closeup_photos: string[]
  pallet_photos: string[]
  recorded_by_name: string | null
  recorded_by: string | null
  if_number: string
  shopify_orders: string
  veeqo_orders: string
  line_number: string
}) {
  const sheets = getPalletSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'App Shipping Records!A:P',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        args.now,
        sanitizeCell(args.system_type || 'fusion'),
        sanitizeCell(args.order_id),
        sanitizeCell(args.carrier),
        sanitizeCell(args.customer || ''),
        sanitizeCell((args.shipment_photos || [])[0] || ''),
        sanitizeCell((args.paperwork_photos || [])[0] || ''),
        sanitizeCell((args.closeup_photos || [])[0] || ''),
        sanitizeCell(args.recorded_by_name || args.recorded_by || ''),
        '',
        '',
        sanitizeCell(args.if_number || ''),
        sanitizeCell(args.shopify_orders || args.veeqo_orders || ''),
        sanitizeCell(args.line_number || ''),
        '',
        sanitizeCell((args.pallet_photos || [])[0] || ''),
      ]],
    },
  })
}

export async function markShippingDeletedInSheet(orderId: string, carrier: string | null) {
  const sheets = getPalletSheets()
  const sheetData = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'App Shipping Records!A:P',
  })
  const rows = sheetData.data.values || []
  const matchingRows: number[] = []
  rows.forEach((r, i) => {
    if (i === 0) return
    const rowOrderId = (r[2] || '').toString()
    const rowCarrier = (r[3] || '').toString()
    const rowStatus = (r[14] || '').toString().toUpperCase()
    if (rowOrderId === (orderId || '').toString() && rowCarrier === (carrier || '').toString() && rowStatus !== 'DELETED') {
      matchingRows.push(i)
    }
  })
  for (const rowIdx of matchingRows) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `App Shipping Records!O${rowIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['DELETED']] },
    })
  }
}
