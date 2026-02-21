import { NextResponse } from 'next/server'
import { fetchSheetData, GIDS } from '@/lib/google-sheets'

// 2026-02-21: Switched to Google Sheets primary (Supabase had stale data, no sync job)

function cellValue(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const cell = row.c?.[col]
  if (!cell || cell.v === null || cell.v === undefined) return ''
  const val = String(cell.v)
  const match = val.match(/^Date\((\d+),(\d+),(\d+)\)$/)
  if (match) {
    const [, y, m, d] = match
    return `${Number(m) + 1}/${d}/${y}`
  }
  return val
}

function wrapResponse(data: Record<string, string>[]) {
  const columns = data.length > 0 ? Object.keys(data[0]) : []
  return { columns, data }
}

export async function GET() {
  try {
    const { cols, rows } = await fetchSheetData(GIDS.orders)
    const data = rows.map((row) => {
      const obj: Record<string, string> = {}
      cols.forEach((colName, i) => {
        const key = colName || `Col${String.fromCharCode(65 + (i % 26))}`
        obj[key] = cellValue(row, i)
      })
      return obj
    }).filter((row) => {
      const line = row['Line'] || row['Col A'] || ''
      return line !== '' && line !== 'Line'
    })
    return NextResponse.json(wrapResponse(data))
  } catch (error) {
    console.error('Failed to fetch all data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch all data' },
      { status: 500 }
    )
  }
}
