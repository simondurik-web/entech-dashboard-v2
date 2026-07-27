import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireDashboardAccess } from '@/lib/require-user'

// Gated 2026-07-27. Per-record audit trail: who changed a pallet and when. It
// needs a record id, so it never appeared in the anonymous endpoint sweep — but
// it was just as open as the others. That is the argument for probing an app
// rather than reading it: parameterised routes hide from a URL sweep.
//
// Gate matches /api/pallet-records rather than the Pallet Records section's
// production-app ACL: this is read by PalletEditModal, which OrderDetail opens
// for ordinary dashboard users. Gating on production membership would have left
// them an empty history panel with no error (codex, review panel 2026-07-27).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireDashboardAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabaseAdmin
    .from('pallet_record_audit')
    .select('*')
    .eq('pallet_record_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}
