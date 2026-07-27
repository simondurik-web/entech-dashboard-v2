#!/usr/bin/env node
/**
 * AUTHORIZED-path probe — the other half of scripts/api-auth-probe.sh.
 *
 * That script proves strangers are kept OUT. This one proves your own people
 * are still let IN, which is the failure mode that actually hurts: a gate that
 * is slightly too tight shows Phil a blank screen on a Monday morning.
 *
 * Built 2026-07-27 because Simon asked the obvious question — "you could run a
 * test and that would save me time" — after I handed him a manual click-through
 * list. He was right. Anything I can check myself, I should.
 *
 *   node scripts/api-authorized-probe.mjs https://dashboard-staging.4molding.com
 *   node scripts/api-authorized-probe.mjs https://dashboard.4molding.com
 *
 * How it signs in: Supabase's admin `generateLink` mints a login token WITHOUT
 * sending any email, and `verifyOtp` exchanges it for a real session. Nothing is
 * written, no message is sent, and the session simply expires. It needs
 * SUPABASE_SERVICE_ROLE_KEY from .env.local, so it only runs on this machine.
 *
 * GET only, like its sibling — safe to run against production.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] ?? 'https://dashboard.4molding.com'
// Whose session to test as. Defaults to the super admin, who should be able to
// reach everything — so any 401/403 here is unambiguously a gate that is wrong,
// not a role that legitimately lacks access.
const AS_EMAIL = process.env.PROBE_AS_EMAIL ?? 'simondurik@gmail.com'

const env = Object.fromEntries(
  readFileSync(join(HERE, '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

// Every endpoint this change gated. An authorized admin must get a 2xx from all
// of them; anything else is a lockout.
const ENDPOINTS = [
  '/api/pallet-records',
  '/api/shipping-records',
  '/api/labels',
  '/api/labels/activity',
  '/api/labels/settings',
  '/api/scheduling/entries',
  '/api/scheduling/employees',
  '/api/scheduling/machines',
  '/api/scheduling/audit',
  '/api/scheduling/hours',
  '/api/admin/permissions',
  '/api/admin/users',
  '/api/notifications/my',
  '/api/notification-rules',
  '/api/orders/assign',
  '/api/quality/products',
  '/api/quality/users',
  '/api/quality/limits',
  '/api/pallet-records/orders',
  '/api/pallet-records/users',
  '/api/erpnext/inventory/warehouses',
  // needs a query param; without it the route answers 400 for everyone, which
  // would read as a lockout when it is nothing of the sort.
  '/api/erpnext/staging/orders?itemCode=__probe__',
]

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: AS_EMAIL,
  })
  if (linkErr) {
    console.error(`could not mint a session for ${AS_EMAIL}: ${linkErr.message}`)
    process.exit(2)
  }

  const anon = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: session, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (otpErr || !session.session) {
    console.error(`could not exchange the token: ${otpErr?.message ?? 'no session'}`)
    process.exit(2)
  }
  const token = session.session.access_token

  console.log(`== authorized reads as ${AS_EMAIL} (expect 2xx) — ${BASE} ==`)
  let fail = 0
  let other = 0
  for (const path of ENDPOINTS) {
    let code
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      })
      code = res.status
    } catch (err) {
      code = `ERR ${err.name}`
    }
    // 401/403 is a LOCKOUT — the thing this probe exists to catch. Any other
    // non-2xx is the endpoint complaining about the request itself (a missing
    // query param, a server error) and is reported separately rather than
    // counted as an access failure, so the result stays honest in both
    // directions.
    const ok = typeof code === 'number' && code >= 200 && code < 300
    const lockedOut = code === 401 || code === 403
    const label = ok ? 'ok    ' : lockedOut ? 'LOCKED' : 'other '
    console.log(`  ${label} ${path.padEnd(46)} ${code}`)
    if (lockedOut) fail++
    else if (!ok) other++
  }

  // Leave no session lying around.
  await anon.auth.signOut()

  console.log()
  if (other) console.log(`(${other} endpoint(s) answered with a non-auth error — check those by hand)`)
  console.log(fail === 0 ? 'PASS — nobody is locked out' : `FAIL — ${fail} endpoint(s) refuse an authorized admin`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
