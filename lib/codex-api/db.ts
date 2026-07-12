import 'server-only'
import { Pool, PoolClient } from 'pg'

// Read-only connection helper for the Codex API.
//
// Connects via the Supabase **transaction-mode pooler** (port 6543)
// AUTHENTICATING DIRECTLY AS `codex_reader` (username
// "codex_reader.<projectref>" in CODEX_READER_DB_URL) — NOT as `postgres`
// with a `SET LOCAL ROLE` switch.
//
// Why this matters (fixed 2026-07-12): the old design connected as `postgres`
// and only *switched* to codex_reader with `SET LOCAL ROLE`. That is NOT a
// security boundary — a query can call `set_config('role','postgres',true)`
// (a function, so a keyword-only validator misses it) to revert to the
// privileged role mid-transaction and read walled-off tables. Authenticating
// directly as codex_reader — a role that is a member of nothing — makes
// `SET ROLE`/`set_config('role',…)` back to postgres impossible: Postgres
// denies it outright.
//
// Boundary now:
//   - codex_reader has no INSERT/UPDATE/DELETE/DDL grants (and READ ONLY txn).
//   - It is the SESSION role; there is no privileged role to escalate to.
//   - Statement timeout is 10s, set per transaction.

let pool: Pool | null = null

function buildConnectionString(): string {
  const override = process.env.CODEX_READER_DB_URL
  if (override) return override
  throw new Error('CODEX_READER_DB_URL is not configured')
}

export function getCodexPool(): Pool {
  if (pool) return pool
  pool = new Pool({
    connectionString: buildConnectionString(),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: false },
  })
  return pool
}

// Wraps a query in a READ ONLY transaction that:
//   1. SET LOCAL statement_timeout   → 10-second cap
//   2. Runs the caller's SQL (session role is already codex_reader)
//   3. COMMITs (RELEASE just returns the connection to the pooler)
//
// No SET LOCAL ROLE — the connection authenticates AS codex_reader, so there
// is nothing to switch from and nothing to escalate back to.
// If the caller's SQL throws, we ROLLBACK and re-throw.
export async function runAsCodexReader<T>(
  fn: (client: PoolClient) => Promise<T>,
  statementTimeoutMs = 10_000,
): Promise<T> {
  const client = await getCodexPool().connect()
  try {
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    throw err
  } finally {
    client.release()
  }
}
