import 'server-only'

import { getSheetsClient } from './google-auth'

type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'
type DateTimeRenderOption = 'SERIAL_NUMBER' | 'FORMATTED_STRING'

type FetchSheetValuesOptions = {
  spreadsheetId: string
  range: string
  valueRenderOption?: ValueRenderOption
  dateTimeRenderOption?: DateTimeRenderOption
}

type FetchSheetValuesByGidOptions = {
  spreadsheetId: string
  gid: string
  valueRenderOption?: ValueRenderOption
  dateTimeRenderOption?: DateTimeRenderOption
}

const sheetTitlesCache = new Map<string, Map<string, string>>()

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

async function getSheetTitle(spreadsheetId: string, gid: string): Promise<string> {
  const cachedTitles = sheetTitlesCache.get(spreadsheetId)
  const cachedTitle = cachedTitles?.get(gid)
  if (cachedTitle) return cachedTitle

  const sheets = getSheetsClient()
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  })

  const titleMap = new Map<string, string>()
  for (const sheet of response.data.sheets ?? []) {
    const props = sheet.properties
    if (!props?.title || props.sheetId === undefined) continue
    titleMap.set(String(props.sheetId), props.title)
  }
  sheetTitlesCache.set(spreadsheetId, titleMap)

  const title = titleMap.get(gid)
  if (!title) {
    throw new Error(`Sheet title not found for gid: ${gid}`)
  }
  return title
}

export async function fetchSheetValues({
  spreadsheetId,
  range,
  valueRenderOption = 'FORMATTED_VALUE',
  dateTimeRenderOption,
}: FetchSheetValuesOptions): Promise<string[][]> {
  const sheets = getSheetsClient()
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption,
    dateTimeRenderOption,
  })

  return (response.data.values ?? []).map((row) =>
    row.map((cell) => String(cell ?? ''))
  )
}

export async function fetchSheetValuesByGid({
  spreadsheetId,
  gid,
  valueRenderOption = 'FORMATTED_VALUE',
  dateTimeRenderOption,
}: FetchSheetValuesByGidOptions): Promise<string[][]> {
  const title = await getSheetTitle(spreadsheetId, gid)
  return fetchSheetValues({
    spreadsheetId,
    range: quoteSheetTitle(title),
    valueRenderOption,
    dateTimeRenderOption,
  })
}

export async function fetchSheetRowsByGid(options: FetchSheetValuesByGidOptions): Promise<string[][]> {
  const values = await fetchSheetValuesByGid(options)
  return values.slice(1)
}
