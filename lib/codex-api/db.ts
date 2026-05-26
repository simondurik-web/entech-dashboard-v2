import 'server-only'
import { Pool, PoolClient } from 'pg'

// Read-only connection helper for the Codex API.
//
// Connects via the Supabase **transaction-mode pooler** (port 6543) as the
// `postgres` role — the pooler doesn't know about custom roles, so we
// connect as the privileged role and immediately switch to `codex_reader`
// at the start of each transaction with `SET LOCAL ROLE`. SET LOCAL is
// transaction-scoped so it survives until COMMIT/ROLLBACK and then resets
// for the next caller that the pooler hands the connection to.
//
// Defense-in-depth still holds:
//   - codex_reader has no INSERT/UPDATE/DELETE/DDL grants.
//   - SET LOCAL ROLE is reverted at transaction end; the next transaction
//     starts as postgres again, but the only way out of `codex_reader`
//     mid-transaction is RESET ROLE / SET ROLE — both are forbidden by
//     the Node-side SQL validator.
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

// Wraps a query in a transaction that:
//   1. SET LOCAL ROLE codex_reader   → drops privileges for this txn
//   2. SET LOCAL statement_timeout   → 10-second cap
//   3. Runs the caller's SQL
//   4. COMMITs (RELEASE just returns the connection — pooler resets state)
//
// If the caller's SQL throws, we ROLLBACK and re-throw.
export async function runAsCodexReader<T>(
  fn: (client: PoolClient) => Promise<T>,
  statementTimeoutMs = 10_000,
): Promise<T> {
  const client = await getCodexPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE codex_reader')
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
