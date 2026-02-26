import { google } from 'googleapis'

let cachedAuth: any = null

export function getGoogleAuth() {
  if (cachedAuth) return cachedAuth

  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString()
    )
    cachedAuth = new google.auth.JWT(
      credentials.client_email,
      undefined,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    return cachedAuth
  }

  throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 env var not set')
}

export function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() })
}
