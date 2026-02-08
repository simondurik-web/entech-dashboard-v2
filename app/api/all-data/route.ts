import { NextResponse } from 'next/server'
import { fetchSheetData, GIDS } from '@/lib/google-sheets'

// Helper to extract cell value
function cellValue(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const cell = row.c?.[col]
  if (!cell || cell.v === null || cell.v === undefined) return ''
  
  // Handle Google Sheets date format: Date(2023,4,22) -> 5/22/2023
  const val = String(cell.v)
  const match = val.match(/^Date\((\d+),(\d+),(\d+)\)$/)
  if (match) {
    const [, y, m, d] = match
    return `${Number(m) + 1}/${d}/${y}`
  }
  
  return val
}

export async function GET() {
  try {
    const { cols, rows } = await fetchSheetData(GIDS.orders)
    
    // Convert to array of objects with column headers as keys
    const data = rows.map((row) => {
      const obj: Record<string, string> = {}
      cols.forEach((colName, i) => {
        // Use column name as key, or fallback to column letter
        const key = colName || `Col${String.fromCharCode(65 + i)}`
        obj[key] = cellValue(row, i)
      })
      return obj
    }).filter((row) => {
      // Filter out completely empty rows
      return Object.values(row).some((v) => v.trim() !== '')
    })
    
    return NextResponse.json({ columns: cols.filter(c => c), data })
  } catch (error) {
    console.error('Failed to fetch all data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch data from Google Sheets' },
      { status: 500 }
    )
  }
}
