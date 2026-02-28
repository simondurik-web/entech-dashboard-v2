import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProfileFromHeader, canEditScheduling, forbidden, unauthorized } from '../_utils'

export async function POST(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const { copiedIds } = await req.json()

    if (!copiedIds || !Array.isArray(copiedIds) || copiedIds.length === 0) {
      return NextResponse.json({ error: 'copiedIds array required' }, { status: 400 })
    }

    // Delete the copied entries
    const { error } = await supabaseAdmin
      .from('scheduling_entries')
      .delete()
      .in('id', copiedIds)

    if (error) throw error

    // Audit log (non-blocking)
    try {
      await supabaseAdmin.from('scheduling_audit_log').insert({
        entry_id: null,
        employee_id: 'BULK',
        action: 'revert_week',
        changed_by: profile.id,
        changed_by_email: profile.email,
        metadata: { revertedIds: copiedIds, count: copiedIds.length },
      })
    } catch (auditErr) {
      console.error('Audit log insert failed (non-blocking):', auditErr)
    }

    return NextResponse.json({ reverted: copiedIds.length })
  } catch (err) {
    console.error('Failed to revert copy:', err)
    return NextResponse.json({ error: 'Failed to revert' }, { status: 500 })
  }
}
