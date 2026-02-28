import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProfileFromHeader, canEditScheduling, forbidden, unauthorized } from '../_utils'

export async function POST(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const { sourceMonday, targetMonday } = await req.json()

    if (!sourceMonday || !targetMonday) {
      return NextResponse.json({ error: 'sourceMonday and targetMonday required' }, { status: 400 })
    }

    // Calculate date ranges (Mon-Sun)
    const sourceDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${sourceMonday}T00:00:00`)
      d.setDate(d.getDate() + i)
      return d.toISOString().split('T')[0]
    })
    const targetDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${targetMonday}T00:00:00`)
      d.setDate(d.getDate() + i)
      return d.toISOString().split('T')[0]
    })

    // Fetch source week entries
    const { data: sourceEntries, error: fetchError } = await supabaseAdmin
      .from('scheduling_entries')
      .select('*')
      .gte('date', sourceDates[0])
      .lte('date', sourceDates[6])

    if (fetchError) throw fetchError

    if (!sourceEntries || sourceEntries.length === 0) {
      return NextResponse.json({ error: 'No entries found in source week', copied: 0 }, { status: 400 })
    }

    // Map source dates to target dates
    const dateMap: Record<string, string> = {}
    sourceDates.forEach((sd, i) => { dateMap[sd] = targetDates[i] })

    // Check for existing entries in target week
    const { data: existingTarget } = await supabaseAdmin
      .from('scheduling_entries')
      .select('id, employee_id, date, shift')
      .gte('date', targetDates[0])
      .lte('date', targetDates[6])

    const existingKeys = new Set(
      (existingTarget || []).map((e) => `${e.employee_id}::${e.date}::${e.shift}`)
    )

    // Create new entries (skip duplicates)
    const newEntries = sourceEntries
      .filter((entry) => {
        const targetDate = dateMap[entry.date]
        return targetDate && !existingKeys.has(`${entry.employee_id}::${targetDate}::${entry.shift}`)
      })
      .map((entry) => ({
        employee_id: entry.employee_id,
        date: dateMap[entry.date],
        shift: entry.shift,
        start_time: entry.start_time,
        end_time: entry.end_time,
        machine_id: entry.machine_id,
      }))

    if (newEntries.length === 0) {
      return NextResponse.json({ message: 'All entries already exist in target week', copied: 0 })
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('scheduling_entries')
      .insert(newEntries)
      .select('id, employee_id')

    if (insertError) throw insertError

    // Audit log (non-blocking — don't fail the copy if audit table has issues)
    try {
      const auditEntries = (inserted || []).map((entry) => ({
        entry_id: entry.id,
        employee_id: entry.employee_id,
        action: 'copy_week',
        changed_by: profile.id,
        changed_by_email: profile.email,
        metadata: { sourceMonday, targetMonday },
      }))

      if (auditEntries.length > 0) {
        await supabaseAdmin.from('scheduling_audit_log').insert(auditEntries)
      }
    } catch (auditErr) {
      console.error('Audit log insert failed (non-blocking):', auditErr)
    }

    return NextResponse.json({
      copied: inserted?.length || 0,
      sourceMonday,
      targetMonday,
      copiedIds: (inserted || []).map((e) => e.id),
    })
  } catch (err) {
    console.error('Failed to copy week:', err)
    return NextResponse.json({ error: 'Failed to copy week' }, { status: 500 })
  }
}
