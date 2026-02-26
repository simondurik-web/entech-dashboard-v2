import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .order('created_date', { ascending: false })

    if (error) throw error

    return NextResponse.json(data || [])
  } catch (err) {
    console.error('Failed to fetch quotes:', err)
    // Fallback to Google Sheets
    try {
      return await fetchFromSheets()
    } catch {
      return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
    }
  }
}

async function fetchFromSheets() {
  const { fetchSheetData, GIDS } = await import('@/lib/google-sheets')
  const { cols, rows } = await fetchSheetData(GIDS.quotesRegistry)
  const headers = cols.map((c, i) => c || `col${i}`)
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h: string, i: number) => {
      obj[h] = row.c?.[i]?.v ?? ''
    })
    return obj
  })
  return NextResponse.json(data)
}
