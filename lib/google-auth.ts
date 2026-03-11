import { google } from 'googleapis'

const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | InstanceType<typeof google.auth.JWT> | null = null

type ServiceAccountCredentials = {
  client_email: string
  private_key: string
  project_id?: string
}

function validateCredentials(credentials: unknown, sourceEnv: string): ServiceAccountCredentials {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error(`${sourceEnv} must decode to a Google service account JSON object.`)
  }

  const parsed = credentials as Record<string, unknown>
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : ''
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n').trim() : ''

  if (!clientEmail) {
    throw new Error(`${sourceEnv} is missing required field: client_email`)
  }

  if (!privateKey) {
    throw new Error(`${sourceEnv} is missing required field: private_key`)
  }

  return {
    ...parsed,
    client_email: clientEmail,
    private_key: privateKey,
  } as ServiceAccountCredentials
}

function parseBase64Credentials(encoded: string) {
  try {
    return validateCredentials(
      JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
      'GOOGLE_SERVICE_ACCOUNT_BASE64'
    )
  } catch (error) {
    throw new Error(
      `Invalid GOOGLE_SERVICE_ACCOUNT_BASE64: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function parseJsonCredentials(raw: string) {
  try {
    return validateCredentials(JSON.parse(raw), 'GOOGLE_SERVICE_ACCOUNT_JSON')
  } catch (error) {
    throw new Error(
      `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    return parseBase64Credentials(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64)
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return parseJsonCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  }

  throw new Error(
    'Google Sheets credentials not found. Set GOOGLE_SERVICE_ACCOUNT_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON, then share the spreadsheet with that service account email.'
  )
}

export function getGoogleAuth() {
  if (cachedAuth) return cachedAuth

  const credentials = loadCredentials()
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [SHEETS_READONLY_SCOPE],
  })
  return cachedAuth
}

export function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() })
}
