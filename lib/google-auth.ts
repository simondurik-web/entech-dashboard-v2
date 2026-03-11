import { google } from 'googleapis'

const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

let cachedAuth: InstanceType<typeof google.auth.GoogleAuth> | InstanceType<typeof google.auth.JWT> | null = null

function parseBase64Credentials(encoded: string) {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch (error) {
    throw new Error(
      `Invalid GOOGLE_SERVICE_ACCOUNT_BASE64: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function parseJsonCredentials(raw: string) {
  try {
    const credentials = JSON.parse(raw)
    if (typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
    }
    return credentials
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
    'Google Sheets credentials not found. Set GOOGLE_SERVICE_ACCOUNT_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON.'
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
