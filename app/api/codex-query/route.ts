import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authorizeCodex } from '@/lib/codex-api/auth'
import { validateSql } from '@/lib/codex-api/validate-sql'
import { getCodexReaderPool } from '@/lib/codex-api/db'
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

  // Run as codex_reader. The role itself has no write privileges and a
  // 10s statement timeout; we set it again here belt-and-suspenders.
  const pool = getCodexReaderPool()
  let client
  try {
    client = await pool.connect()
  } catch (err) {
    const requestId = randomUUID()
    console.error(`[codex-query] pool connect failed (request_id=${requestId}):`, err)
    await logCodexCall(ENDPOINT, req, {}, 'server_error', Date.now() - start, 'pool connect failed')
    return NextResponse.json({ error: 'Internal server error', request_id: requestId }, { status: 500 })
  }

  try {
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
    const result = await client.query({ text: query, values: params })
    const columns = (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID }))
    let rows = result.rows as Record<string, unknown>[]
    const truncated = rows.length > requestedLimit
    if (truncated) rows = rows.slice(0, requestedLimit)

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
    // Postgres errors here are expected when Codex sends malformed SQL or
    // touches a walled-off table. Return them verbatim so Codex can self-
    // correct, but don't leak stack traces.
    await logCodexCall(ENDPOINT, req, { query_prefix: query.slice(0, 120) }, 'query_error', Date.now() - start, message)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  } finally {
    client.release()
  }
}

export async function GET(req: NextRequest) {
  await logCodexCall(ENDPOINT, req, {}, 'method_not_allowed', 0, 'GET not allowed')
  return NextResponse.json({ error: 'Method not allowed. Use POST.' }, { status: 405, headers: { Allow: 'POST' } })
}
