import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { google } from 'googleapis'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_SECRET_PATH = path.resolve(REPO_ROOT, '..', '..', 'secrets', 'google-service-account.json')
const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

let envLoaded = false
let cachedSheetsClient = null
const cachedSheetTitlesBySpreadsheet = new Map()

export function loadLocalEnv() {
  if (envLoaded) return

  const envPath = path.join(REPO_ROOT, '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/)
      if (!match) continue
      const key = match[1].trim()
      if (!process.env[key]) {
        process.env[key] = match[2].trim()
      }
    }
  }

  envLoaded = true
}

function loadServiceAccountCredentials() {
  loadLocalEnv()

  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    try {
      return JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'))
    } catch (error) {
      throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_BASE64: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      if (typeof credentials.private_key === 'string') {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
      }
      return credentials
    } catch (error) {
      throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const explicitPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH
  const credentialPath = explicitPath ? path.resolve(REPO_ROOT, explicitPath) : DEFAULT_SECRET_PATH
  if (fs.existsSync(credentialPath)) {
    return JSON.parse(fs.readFileSync(credentialPath, 'utf8'))
  }

  throw new Error(
    `Google Sheets credentials not found. Set GOOGLE_SERVICE_ACCOUNT_BASE64, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_JSON_PATH, or place a service account at ${DEFAULT_SECRET_PATH}.`
  )
}

export function getSheetsClient() {
  if (cachedSheetsClient) return cachedSheetsClient

  const credentials = loadServiceAccountCredentials()
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [SHEETS_READONLY_SCOPE],
  })

  cachedSheetsClient = google.sheets({ version: 'v4', auth })
  return cachedSheetsClient
}

async function getSheetTitles(spreadsheetId) {
  const cached = cachedSheetTitlesBySpreadsheet.get(spreadsheetId)
  if (cached) return cached

  const sheets = getSheetsClient()
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  })

  const titleMap = new Map()
  for (const sheet of response.data.sheets ?? []) {
    const props = sheet.properties
    if (!props?.title || props.sheetId === undefined) continue
    titleMap.set(String(props.sheetId), props.title)
  }

  cachedSheetTitlesBySpreadsheet.set(spreadsheetId, titleMap)
  return titleMap
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`
}

export async function fetchSheetValuesByGid({
  spreadsheetId,
  gid,
  valueRenderOption = 'FORMATTED_VALUE',
}) {
  const titleMap = await getSheetTitles(spreadsheetId)
  const title = titleMap.get(String(gid))
  if (!title) {
    throw new Error(`Sheet title not found for gid ${gid}`)
  }

  const sheets = getSheetsClient()
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: quoteSheetTitle(title),
    valueRenderOption,
  })

  return (response.data.values ?? []).map((row) => row.map((cell) => String(cell ?? '')))
}

export async function fetchSheetRowsByGid(options) {
  const values = await fetchSheetValuesByGid(options)
  if (values.length === 0) return []
  return values.slice(1)
}

function escapeCsvCell(value) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function valuesToCsv(values) {
  return values.map((row) => row.map(escapeCsvCell).join(',')).join('\n')
}
