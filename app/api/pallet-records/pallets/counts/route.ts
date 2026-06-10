import { NextRequest, NextResponse } from 'next/server'
import { forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { searchParams } = new URL(request.url)
    const lineNumbers = searchParams.get('line_numbers')
    if (!lineNumbers) {
      return NextResponse.json({ error: 'line_numbers required' }, { status: 400 })
    }

    const lines = lineNumbers.split(',').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) return NextResponse.json({})

    const { data, error } = await supabaseAdmin
      .from('pallet_records')
      .select('line_number')
      .in('line_number', lines)

    if (error) throw error

    const counts: Record<string, number> = Object.fromEntries(lines.map((line) => [line, 0]))
    for (const row of data || []) {
      counts[row.line_number] = (counts[row.line_number] || 0) + 1
    }

    return NextResponse.json(counts)
  } catch (error) {
    console.error('Pallet counts error:', error)
    return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 })
  }
}
