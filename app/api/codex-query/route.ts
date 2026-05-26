import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authorizeCodex } from '@/lib/codex-api/auth'
import { validateSql } from '@/lib/codex-api/validate-sql'
import { runAsCodexReader } from '@/lib/codex-api/db'
import { logCodexCall } from '@/lib/codex-api/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = '/api/codex-query'
const MAX_ROWS = 1000
const STATEMENT_TIMEOUT_MS = 10_000

export async function POST(req: NextRequest): Promise<NextResponse> {
  const start = Date.now()

  // Auth
  const auth = authorizeCodex(req)
  if (!auth.ok) {
    if (auth.reason === 'no_key_configured') {
      const requestId = randomUUID()
      console.error(`[codex-query] CODEX_READER_API_KEY not configured (request_id=${requestId})`)
      await logCodexCall(ENDPOINT, req, {}, 'server_error', Date.now() - start, 'api key not configured')
      return NextResponse.json({ error: 'Internal server error', request_id: requestId }, { status: 500 })
    }
    await logCodexCall(ENDPOINT, req, {}, 'unauthorized', Date.now() - start, null)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let body: { query?: unknown; params?: unknown; limit?: unknown }
  try {
    body = await req.json()
  } catch {
    await logCodexCall(ENDPOINT, req, {}, 'bad_request', Date.now() - start, 'malformed json')
    return NextResponse.json({ error: 'Body must be valid JSON: { query: string, params?: any[], limit?: number }' }, { status: 400 })
  }

  const query = body?.query
  if (typeof query !== 'string') {
    await logCodexCall(ENDPOINT, req, {}, 'bad_request', Date.now() - start, 'missing query')
    return NextResponse.json({ error: 'Missing required field: query (string)' }, { status: 400 })
  }

  const params = Array.isArray(body?.params) ? body.params as unknown[] : []
  const requestedLimit = typeof body?.limit === 'number' && body.limit > 0 ? Math.min(body.limit, MAX_ROWS) : MAX_ROWS

  // Validate SQL shape
  const validation = validateSql(query)
  if (!validation.ok) {
    await logCodexCall(ENDPOINT, req, { query_prefix: query.slice(0, 120) }, 'validation_failed', Date.now() - start, validation.reason)
    return NextResponse.json({ error: `SQL validation failed: ${validation.reason}` }, { status: 400 })
  }

  // Run inside a txn that drops privileges to codex_reader via SET LOCAL
  // ROLE. The role has no INSERT/UPDATE/DELETE/DDL grants, so even if
  // the validator missed something, write attempts fail at the DB layer.
  try {
    const { columns, rows, truncated } = await runAsCodexReader(async (client) => {
      const result = await client.query({ text: query, values: params })
      const cols = (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID }))
      let rs = result.rows as Record<string, unknown>[]
      const tr = rs.length > requestedLimit
      if (tr) rs = rs.slice(0, requestedLimit)
      return { columns: cols, rows: rs, truncated: tr }
    }, STATEMENT_TIMEOUT_MS)

    await logCodexCall(ENDPOINT, req, { query_prefix: query.slice(0, 120), row_count: rows.length }, 'ok', Date.now() - start, null)
    return NextResponse.json({
      ok: true,
      columns,
      rows,
      row_count: rows.length,
      truncated,
      elapsed_ms: Date.now() - start,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isConnect = /connect|timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(message)
    if (isConnect) {
      const requestId = randomUUID()
      console.error(`[codex-query] DB connection failed (request_id=${requestId}):`, message)
      await logCodexCall(ENDPOINT, req, { query_prefix: query.slice(0, 120) }, 'server_error', Date.now() - start, `db connect: ${message}`)
      return NextResponse.json({ error: 'Internal server error', request_id: requestId }, { status: 500 })
    }
    // Query-level error (bad SQL, permission denied on walled-off table) —
    // return verbatim so Codex can self-correct.
    await logCodexCall(ENDPOINT, req, { query_prefix: query.slice(0, 120) }, 'query_error', Date.now() - start, message)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  await logCodexCall(ENDPOINT, req, {}, 'method_not_allowed', 0, 'GET not allowed')
  return NextResponse.json({ error: 'Method not allowed. Use POST.' }, { status: 405, headers: { Allow: 'POST' } })
}
