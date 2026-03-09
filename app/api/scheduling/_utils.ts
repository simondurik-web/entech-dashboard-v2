import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const DASHBOARD_APP_ID = 'dashboard'

/** Get user profile from x-user-id header, with app-specific role overlay */
export async function getProfileFromHeader(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return null

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, role')
    .eq('id', userId)
    .single()

  if (!profile) return null

  // Overlay app-specific role
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', DASHBOARD_APP_ID)
    .single()

  if (appRole) {
    return { ...profile, role: appRole.role }
  }
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
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Indiana/Indianapolis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

/** Normalize date input to YYYY-MM-DD */
export function normalizeDateInput(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const d = new Date(date)
  if (isNaN(d.getTime())) return date
  return d.toISOString().split('T')[0]
}
