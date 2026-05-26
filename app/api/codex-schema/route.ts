import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authorizeCodex } from '@/lib/codex-api/auth'
import { runAsCodexReader } from '@/lib/codex-api/db'
import { logCodexCall } from '@/lib/codex-api/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = '/api/codex-schema'

// Returns the schema of every table the codex_reader role can SELECT.
// Codex calls this once at session start to learn what's available.
// Walled-off tables (auth/PII/audit) automatically don't appear because
// the role has no SELECT privilege on them, so has_table_privilege
// filters them out.
//
// Format:
//   {
//     fetched_at: "...",
//     table_count: 52,
//     tables: [
//       { name: "customers", description: "...", columns: [{ name, type, nullable }] },
//       ...
//     ]
//   }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const start = Date.now()

  const auth = authorizeCodex(req)
  if (!auth.ok) {
    if (auth.reason === 'no_key_configured') {
      const requestId = randomUUID()
      console.error(`[codex-schema] CODEX_READER_API_KEY not configured (request_id=${requestId})`)
      await logCodexCall(ENDPOINT, req, {}, 'server_error', Date.now() - start, 'api key not configured')
      return NextResponse.json({ error: 'Internal server error', request_id: requestId }, { status: 500 })
    }
    await logCodexCall(ENDPOINT, req, {}, 'unauthorized', Date.now() - start, null)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const out = await runAsCodexReader(async (client) => {
      // Pull tables that codex_reader can SELECT. has_table_privilege
      // walls off the seven excluded tables automatically.
      const tables = await client.query(`
        SELECT
          c.relname AS name,
          obj_description(c.oid, 'pg_class') AS description
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'v', 'm')
          AND has_table_privilege(current_user, c.oid, 'SELECT')
        ORDER BY c.relname
      `)

      // Columns for those tables, in one shot.
      const cols = await client.query(`
        SELECT
          c.table_name,
          c.column_name AS name,
          c.data_type AS type,
          c.is_nullable = 'YES' AS nullable,
          col_description(((c.table_schema || '.' || c.table_name)::regclass)::oid, c.ordinal_position) AS description
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND has_table_privilege(current_user, (c.table_schema || '.' || c.table_name)::regclass, 'SELECT')
        ORDER BY c.table_name, c.ordinal_position
      `)

      const colsByTable = new Map<string, Array<{ name: string; type: string; nullable: boolean; description: string | null }>>()
      for (const r of cols.rows as Array<{ table_name: string; name: string; type: string; nullable: boolean; description: string | null }>) {
        const list = colsByTable.get(r.table_name) || []
        list.push({ name: r.name, type: r.type, nullable: r.nullable, description: r.description })
        colsByTable.set(r.table_name, list)
      }

      return (tables.rows as Array<{ name: string; description: string | null }>).map((t) => ({
        name: t.name,
        description: t.description,
        columns: colsByTable.get(t.name) || [],
      }))
    })

    await logCodexCall(ENDPOINT, req, { table_count: out.length }, 'ok', Date.now() - start, null)
    return NextResponse.json({
      fetched_at: new Date().toISOString(),
      table_count: out.length,
      tables: out,
    })
  } catch (err) {
    const requestId = randomUUID()
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[codex-schema] error (request_id=${requestId}):`, message)
    await logCodexCall(ENDPOINT, req, {}, 'server_error', Date.now() - start, message)
    return NextResponse.json({ error: 'Internal server error', request_id: requestId }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  await logCodexCall(ENDPOINT, req, {}, 'method_not_allowed', 0, 'POST not allowed')
  return NextResponse.json({ error: 'Method not allowed. Use GET.' }, { status: 405, headers: { Allow: 'GET' } })
}
