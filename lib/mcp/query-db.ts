import "server-only"
import { Pool, type PoolClient } from "pg"
import { POOLER_CA } from "@/lib/mcp/pooler-ca"

/**
 * Read-only DB access for the MCP run_query / describe_tables tools.
 *
 * Connects to the Supabase transaction pooler AUTHENTICATING DIRECTLY AS
 * `mcp_query_reader` (not as `postgres` + SET ROLE). This is the security
 * crux: because the session role is a plain role that is a member of nothing,
 * an in-query `set_config('role','postgres',…)` / `SET ROLE` is denied by
 * Postgres, so free-form SQL cannot escalate back to a privileged role and
 * read the walled-off auth/token tables.
 *
 * Layers, outermost to innermost:
 *   1. Session role = mcp_query_reader — no write grants, no escalation path.
 *   2. SELECT granted only on non-sensitive tables (auth/token/PII revoked).
 *   3. Per-transaction READ ONLY + statement_timeout.
 *   4. Node-side SQL validation happens before we ever get here.
 */

let pool: Pool | null = null

function connString(): string {
  const url = process.env.MCP_QUERY_DB_URL
  if (!url) throw new Error("MCP_QUERY_DB_URL is not configured")
  return url
}

function getPool(): Pool {
  if (pool) return pool
  pool = new Pool({
    connectionString: connString(),
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Pinned Supabase pooler CA — the pooler presents a self-signed chain, so
    // we verify against THIS cert instead of disabling verification. Defeats a
    // MITM/DNS attacker who would otherwise capture the role password.
    ssl: { ca: POOLER_CA, rejectUnauthorized: true },
  })
  return pool
}

export async function runReadOnlyQuery<T>(
  fn: (client: PoolClient) => Promise<T>,
  statementTimeoutMs = 6_000,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query("BEGIN TRANSACTION READ ONLY")
    await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`)
    // Bound the memory a single query can grab. work_mem caps sort/hash/agg
    // spill thresholds; the tight statement_timeout is the backstop for an
    // aggregate that tries to build a giant array/value in memory.
    await client.query("SET LOCAL work_mem = '16MB'")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (err) {
    try {
      await client.query("ROLLBACK")
    } catch {
      /* connection already broken */
    }
    throw err
  } finally {
    client.release()
  }
}
