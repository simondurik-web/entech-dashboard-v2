import { fetchSheetValuesByGid, loadLocalEnv, valuesToCsv } from './lib/google-sheets-auth.mjs'

const [, , gidArg, formatArg = 'csv'] = process.argv
const gid = gidArg?.trim()
const format = formatArg.trim().toLowerCase()

loadLocalEnv()

const spreadsheetId = process.env.GOOGLE_SHEET_ID || '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'

if (!gid) {
  console.error('Usage: node scripts/export-sheet.mjs <gid> [csv|json]')
  process.exit(1)
}

if (!['csv', 'json'].includes(format)) {
  console.error(`Unsupported format: ${format}`)
  process.exit(1)
}

try {
  const values = await fetchSheetValuesByGid({ spreadsheetId, gid })
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(values)}\n`)
  } else {
    process.stdout.write(`${valuesToCsv(values)}\n`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
