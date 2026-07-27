import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireDashboardAccess } from '@/lib/require-user'

// GET: the caller's recent notifications (last 50).
//
// Gated AND scoped 2026-07-27. It used to answer anonymous callers with the
// last 50 rows of notification_log for the WHOLE company — titles, bodies, who
// sent them and who they were aimed at. Gating alone would have left the second
// half of that wrong (codex and grok both flagged it): an authenticated
// shipping user would still read a message addressed to one manager.
//
// What counts as the caller's row, read off the two writers rather than
// guessed (codex, review panel round 3 — I had this backwards first time):
//   * /api/notifications/send stores target_role=null AND target_user_id=null
//     when an admin sends to EVERYONE. That is the real broadcast, and my first
//     filter excluded it, which would have hidden every company-wide
//     announcement from every bell.
//   * /api/cron/check-order-changes stores target_role='auto' for the
//     automatic order-change alerts. Those go to whoever is configured in
//     notification_rules, which notification_log does not record, so the bell
//     cannot reproduce that list. They are shown to enrolled users — the same
//     order information those users can already read on the Orders page. This
//     is a deliberate imprecision, not an oversight.
//   * Anything else must match the caller or the caller's role. A row targeted
//     at one person or one role is never widened.
export async function GET(req: NextRequest) {
  const actor = await requireDashboardAccess(req)
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // Filtered in SQL, not in JS: filtering after a fixed-size read meant a
    // burst of other people's notifications could push the caller's own rows
    // out of the window entirely (grok, review panel round 2).
    const role = actor.role ?? ''
    const clauses = [
      `target_user_id.eq.${actor.id}`,
      'and(target_user_id.is.null,target_role.is.null)',
      'and(target_user_id.is.null,target_role.eq.auto)',
    ]
    // Add the role clause only for a plain role name. Two reasons in one test:
    // an empty role would build `target_role.eq.` — a malformed PostgREST
    // filter that fails the whole query rather than matching nothing — and a
    // role containing a comma or paren would rewrite the .or() expression
    // instead of erroring, which is filter injection one bad row away (grok,
    // review panel round 3).
    // Role-targeted rows must also be untargeted at a PERSON. Without the
    // extra `target_user_id.is.null`, a row carrying both a user and a role
    // would match on the role and show one person's private notification to
    // their whole role (codex, review panel round 5).
    if (/^[a-z_]+$/.test(role)) {
      clauses.push(`and(target_user_id.is.null,target_role.eq.${role})`)
    }
    const { data, error } = await supabaseAdmin
      .from('notification_log')
      .select('*')
      .or(clauses.join(','))
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const notifications = (data || []).map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      sentBy: n.sent_by,
      targetRole: n.target_role,
      targetUserId: n.target_user_id,
      sentCount: n.sent_count,
      createdAt: n.created_at,
      isAuto: n.target_role === 'auto',
    }))

    return NextResponse.json({ notifications })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
