import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function getRequestProfile(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single()

  return profile
}

export function canEditScheduling(role: string) {
  return ['admin', 'super_admin', 'manager', 'group_leader'].includes(role)
}

export function canSeePayRate(role: string) {
  return ['admin', 'super_admin', 'manager'].includes(role)
}

export function canViewHistory(role: string) {
  return ['admin', 'super_admin', 'manager', 'group_leader'].includes(role)
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** Returns today's date in YYYY-MM-DD for America/Indiana/Indianapolis */
export function getIndianapolisTodayIso(): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Indiana/Indianapolis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(now) // en-CA gives YYYY-MM-DD format
}

/** Normalize date input to YYYY-MM-DD */
export function normalizeDateInput(date: string): string {
  // If already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  // Try to parse and format
  const d = new Date(date)
  if (isNaN(d.getTime())) return date
  return d.toISOString().split('T')[0]
}

/** Resolve the employee_id for a regular user based on their email */
export async function resolveEmployeeIdForRegular(profile: { id: string; email: string; role: string }): Promise<string | null> {
  // For now, we can't auto-resolve — regular users see nothing unless
  // we add an email field to scheduling_employees or a mapping table.
  // This is a placeholder that returns null (no entries shown).
  // TODO: Add email mapping to scheduling_employees
  return null
}
