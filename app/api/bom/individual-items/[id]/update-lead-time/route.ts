import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { lead_time: number | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { lead_time } = body

  // Validation: must be positive integer or null
  if (lead_time !== null) {
    if (typeof lead_time !== 'number' || !Number.isInteger(lead_time) || lead_time <= 0) {
      return NextResponse.json(
        { error: 'lead_time must be a positive integer or null' },
        { status: 400 }
      )
    }
  }

  const { data, error } = await supabaseAdmin
    .from('bom_individual_items')
    .update({ lead_time, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, lead_time')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, lead_time: data.lead_time })
}
