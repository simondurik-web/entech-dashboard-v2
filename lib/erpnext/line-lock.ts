import { supabaseAdmin } from '@/lib/supabase-admin'

// Per-line staging lease (see supabase/migrations/20260720_staging_line_locks.sql).
// Serializes staging/assign's destructive phase per release line so concurrent
// stations can't both pass the capacity check and strand the loser's pallet
// (codex review residual, approved by Simon 2026-07-20).

// Longer than the route's maxDuration (120s): a crashed holder's lease outlives
// any request that could still be mutating, then self-expires.
const LOCK_TTL_SECONDS = 130

export class LineLockedError extends Error {
  constructor(lineKey: string) {
    super(`Another station is staging this ${lineKey.includes(':') ? 'line' : 'order'} right now — try again in a moment`)
    this.name = 'LineLockedError'
  }
}

/** Run `fn` holding the per-line lease. Throws LineLockedError (409 material)
 *  when another holder has it. Re-entrant for the same holder (an op retry with
 *  the same idempotency key re-claims its own lease). Release is best-effort —
 *  a failed release just leaves the lease to its TTL. */
export async function withLineLock<T>(lineKey: string, holder: string, fn: () => Promise<T>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc('claim_staging_line_lock', {
    p_key: lineKey,
    p_holder: holder,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  })
  // Fail CLOSED: if the lock service can't answer, the destructive phase must
  // not proceed unserialized.
  if (error) throw new Error(`Could not acquire the staging lock — nothing was changed, try again (${error.message})`)
  if (data !== true) throw new LineLockedError(lineKey)
  try {
    return await fn()
  } finally {
    await supabaseAdmin
      .rpc('release_staging_line_lock', { p_key: lineKey, p_holder: holder })
      .then(({ error: e }) => {
        if (e) console.error(`line-lock release failed for ${lineKey} (lease expires in ${LOCK_TTL_SECONDS}s):`, e)
      })
  }
}
