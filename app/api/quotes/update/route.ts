import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PUT(request: Request) {
  try {
    const { id, status, notes } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Quote id is required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (status !== undefined) updates.status = status
    if (notes !== undefined) updates.notes = notes

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('quotes')
      .update(updates)
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to update quote:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update quote' },
      { status: 500 }
    )
  }
}
