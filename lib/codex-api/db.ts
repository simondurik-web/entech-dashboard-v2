import 'server-only'
import { Pool } from 'pg'

// Dedicated read-only connection pool for the Codex API.
//
// The connection string points at the `codex_reader` Postgres role which
// has SELECT on most public tables and nothing else (no INSERT/UPDATE/
// DELETE, no DDL). Even if the Node-side validator misses a clever
// bypass, the role itself can't write. statement_timeout is 10s on the
// role, so runaway queries get cut off by the DB.
//
// Pool size kept tight because Codex callers are low-volume (one human
// driving it) and we share the cap with the rest of the Vercel function.

let pool: Pool | null = null

export function getCodexReaderPool(): Pool {
  if (pool) return pool
  const connString = process.env.CODEX_READER_DB_URL
  if (!connString) {
    throw new Error('CODEX_READER_DB_URL is not configured')
  }
  pool = new Pool({
    connectionString: connString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: false },  // Supabase pooler uses cert chain that needs trust=loose
  })
  return pool
}
