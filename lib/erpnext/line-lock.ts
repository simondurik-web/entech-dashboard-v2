import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Staging leases (see supabase/migrations/20260720_staging_line_locks.sql).
// Serializes staging/assign's destructive phase so concurrent stations can't
// both pass the capacity check and strand the loser's pallet, and so the same
// pallet can't be moved by two requests at once (codex review, approved by
// Simon 2026-07-20).
//
// Key scheme: one lease per Sales ORDER (`so:<name>`) — deliberately coarser
// than per-line, so an auto-allocating request (no line picked) and an
// explicit-line request on the same order contend on the SAME key (per-line
// keys let them race past each other; codex lock-review round 1). Moves add
// one lease per affected pallet family (`pallet:<base>`), covering the pallet
// itself across whichever orders are fighting over it.
//
// NO re-entry: the holder token is unique per REQUEST, minted here. Keying the
// holder to the idempotency key let a same-key duplicate re-claim, take its
// pending-op 409, and then RELEASE the lease its finally-block thought was its
// own while the original request was still mutating (codex/grok lock-review
// round 2). A duplicate now simply fails the claim and 409s "try again"; a
// crashed holder's lease self-expires within the TTL.

// Longer than the route's maxDuration (120s): a crashed holder's lease outlives
// any request that could still be mutating, then self-expires.
const LOCK_TTL_SECONDS = 130

export class LineLockedError extends Error {
  constructor(key: string) {
    super(
      key.startsWith('pallet:')
        ? 'One of these pallets is being staged from another station right now — try again in a moment'
        : 'This order is being staged from another station right now — try again in a moment'
    )
    this.name = 'LineLockedError'
  }
}

async function claim(key: string, holder: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('claim_staging_line_lock', {
    p_key: key,
    p_holder: holder,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  })
  // Fail CLOSED: if the lock service can't answer, the destructive phase must
  // not proceed unserialized.
  if (error) throw new Error(`Could not acquire the staging lock — nothing was changed, try again (${error.message})`)
  return data === true
}

async function release(key: string, holder: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('release_staging_line_lock', { p_key: key, p_holder: holder })
  if (error) console.error(`lease release failed for ${key} (self-expires in ${LOCK_TTL_SECONDS}s):`, error)
}

/** Run `fn` holding ALL the given leases under a request-unique holder token.
 *  Keys are deduped and claimed in sorted order (stable global order -> no
 *  deadlock between concurrent multi-key claimers). All-or-nothing: any miss
 *  releases what was claimed and throws LineLockedError. Release is
 *  best-effort — a failed release leaves the lease to its TTL. */
export async function withLeases<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const holder = randomUUID()
  const ordered = [...new Set(keys)].sort()
  const held: string[] = []
  try {
    for (const key of ordered) {
      if (!(await claim(key, holder))) throw new LineLockedError(key)
      held.push(key)
    }
    return await fn()
  } finally {
    for (const key of held) await release(key, holder)
  }
}
