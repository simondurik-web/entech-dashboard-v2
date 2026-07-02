import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FROM = 'Molding Dashboard Login <automated@4molding.com>'
const COOLDOWN_SECONDS = 45
// This path uses admin generateLink + Resend directly, so it bypasses Supabase's
// global email rate limit — cap per-IP ourselves as a backstop. The per-email
// cooldown is the durable floor; the IP cap is generous because corporate users
// (the whole point of this flow) egress through one shared NAT IP, and it only
// counts codes actually SENT (cooldown-rejected resends don't burn the budget).
const IP_WINDOW_SECONDS = 600
const IP_MAX_IN_WINDOW = 30

// Read-only check: is this IP key over its send budget in the current window?
// The `email` column doubles as a generic throttle key (IP rows use an "ip:"
// prefix, which can't collide with a real address since real emails contain "@").
async function ipOverLimit(ipKey: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('molding_login_otp_throttle')
    .select('sent_count, window_start')
    .eq('email', ipKey)
    .maybeSingle()
  if (data?.window_start) {
    const windowAgeMs = Date.now() - new Date(data.window_start).getTime()
    if (windowAgeMs < IP_WINDOW_SECONDS * 1000 && (data.sent_count ?? 0) >= IP_MAX_IN_WINDOW) {
      return true
    }
  }
  return false
}

// Record one actually-sent code against the IP window (increment in-window, or
// start a fresh window). Called only AFTER a successful send.
async function recordIpSend(ipKey: string): Promise<void> {
  const nowMs = Date.now()
  const { data } = await supabaseAdmin
    .from('molding_login_otp_throttle')
    .select('sent_count, window_start')
    .eq('email', ipKey)
    .maybeSingle()
  if (data?.window_start && nowMs - new Date(data.window_start).getTime() < IP_WINDOW_SECONDS * 1000) {
    await supabaseAdmin
      .from('molding_login_otp_throttle')
      .update({ sent_count: (data.sent_count ?? 0) + 1, last_sent_at: new Date(nowMs).toISOString() })
      .eq('email', ipKey)
  } else {
    await supabaseAdmin.from('molding_login_otp_throttle').upsert({
      email: ipKey,
      sent_count: 1,
      window_start: new Date(nowMs).toISOString(),
      last_sent_at: new Date(nowMs).toISOString(),
    })
  }
}

// Passwordless LOGIN CODE — the corporate-email-safe replacement for the magic
// link. We ask Supabase to GENERATE (not send) an email OTP via the admin API,
// then deliver the 8-digit code ourselves through Resend, fully branded "Molding
// Dashboard Login". Because Supabase's shared mailer is never used, this doesn't
// touch the SnapPad/Quality apps on the same project, and because the user TYPES
// the code, Outlook Safe Links can't consume a one-time link. The code is verified
// client-side (supabase.auth.verifyOtp) — see lib/auth-context verifyEmailCode.
export async function POST(request: NextRequest) {
  let email = ''
  try {
    const body = await request.json()
    email = String(body?.email ?? '').trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  // Trusted client IP. On Vercel x-vercel-forwarded-for is set by the platform and
  // can't be spoofed by the caller; raw x-forwarded-for[0] is client-supplied, so
  // it's only a fallback for non-Vercel/local runs.
  const ip =
    (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || '')
      .split(',')[0]
      .trim() || 'unknown'
  const ipKey = `ip:${ip}`

  // Per-email cooldown FIRST — a rapid "resend" is rejected here without burning
  // the shared-IP budget. Generic response either way; never reveal whether the
  // address exists.
  const { data: throttle } = await supabaseAdmin
    .from('molding_login_otp_throttle')
    .select('last_sent_at')
    .eq('email', email)
    .maybeSingle()
  if (throttle?.last_sent_at) {
    const ageMs = Date.now() - new Date(throttle.last_sent_at).getTime()
    if (ageMs < COOLDOWN_SECONDS * 1000) {
      return NextResponse.json(
        { error: 'Please wait a moment before requesting another code.' },
        { status: 429 }
      )
    }
  }

  // Per-IP window backstop (check-only; the counter is bumped after a real send).
  if (await ipOverLimit(ipKey)) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again in a few minutes.' },
      { status: 429 }
    )
  }

  // Generate (does NOT send) a login OTP. type 'magiclink' returns email_otp for
  // both existing users and auto-creates a fresh auth user for new emails —
  // matching the prior magic-link behavior. Still gated: the client verify funnels
  // new logins through /api/auth/profile, which provisions role 'visitor' (no access).
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (error || !data?.properties?.email_otp) {
    console.error('OTP generate error:', error)
    return NextResponse.json({ error: 'Could not start sign-in. Try again.' }, { status: 500 })
  }
  const code = data.properties.email_otp

  const send = await sendEmail({
    from: FROM,
    to: [email],
    subject: 'Your Molding Dashboard login code',
    html: buildHtml(code),
    text: `Your Molding Dashboard login code is ${code}\n\nEnter it on the sign-in screen to log in. The code expires in 1 hour. If you didn't request this, you can ignore this email.`,
  })
  if (!send.sent) {
    console.error('OTP email send failed:', send.error || send.skipped)
    return NextResponse.json({ error: 'Could not send the code. Try again.' }, { status: 502 })
  }

  // Record the send: per-email cooldown stamp + per-IP window increment. Only
  // actual sends count toward the IP budget.
  await supabaseAdmin.from('molding_login_otp_throttle').upsert({
    email,
    last_sent_at: new Date().toISOString(),
  })
  await recordIpSend(ipKey)

  return NextResponse.json({ ok: true })
}

function buildHtml(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0a0e1a;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;text-align:center;">
    <h1 style="margin:0 0 4px;color:#fff;font-size:20px;">Molding Dashboard</h1>
    <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;">Your login code</p>
    <div style="font-size:34px;letter-spacing:8px;font-weight:700;color:#fff;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 12px;">${code}</div>
    <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;line-height:1.5;">Enter this code on the sign-in screen to log in. It expires in 1 hour.</p>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
  </div>
</body></html>`
}
