import { google } from 'googleapis'

const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
const MAIN_DATA_SHEET = 'Main Data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedWriteAuth: any = null

function getWriteAuth() {
  if (cachedWriteAuth) return cachedWriteAuth

  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString()
    )
    cachedWriteAuth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    return cachedWriteAuth
  }

  throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 env var not set')
}

function getSheetsWriteClient() {
  return google.sheets({ version: 'v4', auth: getWriteAuth() })
}

/**
 * Find the row number in Main Data for a given line number.
 * Returns 1-indexed row number (for A1 notation).
 */
async function findRowByLine(lineNumber: string): Promise<number | null> {
  const sheets = getSheetsWriteClient()
  // Read column A (line numbers) - up to 5000 rows
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${MAIN_DATA_SHEET}'!A1:A5000`,
  })

  const rows = res.data.values
  if (!rows) return null

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(lineNumber).trim()) {
      return i + 1 // 1-indexed
    }
  }
  return null
}

/**
 * Update the "Assigned to" column (AV = column 48) for a given line number.
 */
export async function updateAssignedTo(lineNumber: string, assignedTo: string): Promise<{ success: boolean; error?: string }> {
  try {
    const rowNum = await findRowByLine(lineNumber)
    if (!rowNum) {
      return { success: false, error: `Line ${lineNumber} not found in Main Data sheet` }
    }

    const sheets = getSheetsWriteClient()
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${MAIN_DATA_SHEET}'!AV${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[assignedTo]],
      },
    })

    return { success: true }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
