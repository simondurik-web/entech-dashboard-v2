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
  const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
  const GID = '1279128282'
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  const text = await res.text()
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/)
  if (!match) throw new Error('Failed to parse sheet')
  const json = JSON.parse(match[1])
  const cols = json.table.cols as { label: string }[]
  const rows = json.table.rows as { c: ({ v: unknown } | null)[] }[]
  let headers = cols.map((c: { label: string }, i: number) => c.label || `col${i}`)
  if (headers.every((h: string) => h.startsWith('col')) && rows.length > 0) {
    headers = rows[0].c.map((cell: { v: unknown } | null, i: number) =>
      cell?.v != null ? String(cell.v) : `col${i}`
    )
    rows.shift()
  }
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h: string, i: number) => {
      obj[h] = row.c?.[i]?.v ?? ''
    })
    return obj
  })
  return NextResponse.json(data)
}
