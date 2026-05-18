import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomUUID, timingSafeEqual } from 'crypto'

// Read-only price-lookup endpoint for the external Codex automation agent.
//
// SELECTs from customer_part_mappings + customers using the anon Supabase key
// (RLS public_read_* policies cover both tables). INSERT into api_audit_log is
// the ONLY write path. The service-role key is never read here.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type AuditResult =
  | 'found'
  | 'not_found'
  | 'unauthorized'
  | 'bad_request'
  | 'method_not_allowed'
  | 'server_error'

function getAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Supabase env vars missing')
  }
  return createClient(url, anonKey, { auth: { persistSession: false } })
}

function callerIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}

async function logAudit(
  client: SupabaseClient,
  endpoint: string,
  req: NextRequest,
  queryParams: Record<string, string | null>,
  result: AuditResult,
  responseTimeMs: number,
  errorMessage: string | null,
): Promise<void> {
  try {
    await client.from('api_audit_log').insert({
      endpoint,
      caller_ip: callerIp(req),
      caller_user_agent: req.headers.get('user-agent'),
      query_params: queryParams,
      result,
      response_time_ms: responseTimeMs,
      error_message: errorMessage,
    })
  } catch {
    // Never let audit failure block the response. Surface in server logs only,
    // and not the API key or the Authorization header.
    console.error('[price-lookup] audit log insert failed')
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  // Pad both to the longer length so timingSafeEqual doesn't throw on length mismatch.
  const len = Math.max(aBuf.length, bBuf.length)
  const aPad = Buffer.alloc(len)
  const bPad = Buffer.alloc(len)
  aBuf.copy(aPad)
  bBuf.copy(bPad)
  const equal = timingSafeEqual(aPad, bPad)
  return equal && aBuf.length === bBuf.length
}

function authorize(req: NextRequest): { ok: true } | { ok: false; reason: 'no_key_configured' | 'missing' | 'invalid' } {
  const expected = process.env.PRICE_LOOKUP_API_KEY
  if (!expected) return { ok: false, reason: 'no_key_configured' }

  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/)
  if (!match) return { ok: false, reason: 'missing' }

  const provided = match[1].trim()
  if (!provided) return { ok: false, reason: 'missing' }

  return timingSafeStringEqual(provided, expected)
    ? { ok: true }
    : { ok: false, reason: 'invalid' }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const start = Date.now()
  const endpoint = '/api/price-lookup'
  const url = new URL(req.url)
  const customer = url.searchParams.get('customer')
  const internalPn = url.searchParams.get('internal_pn')
  const queryParams = { customer, internal_pn: internalPn }

  let supabase: SupabaseClient
  try {
    supabase = getAnonClient()
  } catch (err) {
    const requestId = randomUUID()
    console.error(`[price-lookup] supabase client init failed (request_id=${requestId})`)
    return NextResponse.json(
      { error: 'Internal server error', request_id: requestId },
      { status: 500 },
    )
  }

  // Auth
  const authResult = authorize(req)
  if (!authResult.ok) {
    if (authResult.reason === 'no_key_configured') {
      const requestId = randomUUID()
      console.error(`[price-lookup] PRICE_LOOKUP_API_KEY is unset — refusing all requests (request_id=${requestId})`)
      await logAudit(supabase, endpoint, req, queryParams, 'server_error', Date.now() - start, 'PRICE_LOOKUP_API_KEY not configured')
      return NextResponse.json(
        { error: 'Internal server error', request_id: requestId },
        { status: 500 },
      )
    }
    await logAudit(supabase, endpoint, req, queryParams, 'unauthorized', Date.now() - start, null)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Param validation
  if (!customer || !internalPn) {
    await logAudit(supabase, endpoint, req, queryParams, 'bad_request', Date.now() - start, null)
    return NextResponse.json(
      { error: 'Missing required query params: customer, internal_pn' },
      { status: 400 },
    )
  }

  // Lookup
  try {
    const { data: customerRows, error: custErr } = await supabase
      .from('customers')
      .select('id, name')
      .ilike('name', customer)
      .limit(1)

    if (custErr) throw custErr

    const queriedAt = new Date().toISOString()

    if (!customerRows || customerRows.length === 0) {
      await logAudit(supabase, endpoint, req, queryParams, 'not_found', Date.now() - start, null)
      return NextResponse.json({
        found: false,
        customer,
        internal_pn: internalPn,
        message: 'No matching record in customer reference table',
        queried_at: queriedAt,
      })
    }

    const customerId = customerRows[0].id as string
    const customerName = customerRows[0].name as string

    const { data: mappings, error: mapErr } = await supabase
      .from('customer_part_mappings')
      .select('internal_part_number, customer_part_number, category, lowest_quoted_price, variable_cost, total_cost, sales_target, contribution_level')
      .eq('customer_id', customerId)
      .ilike('internal_part_number', internalPn)

    if (mapErr) throw mapErr

    if (!mappings || mappings.length === 0) {
      await logAudit(supabase, endpoint, req, queryParams, 'not_found', Date.now() - start, null)
      return NextResponse.json({
        found: false,
        customer: customerName,
        internal_pn: internalPn,
        message: 'No matching record in customer reference table',
        queried_at: queriedAt,
      })
    }

    // If multiple rows match (known duplicate-mapping case), pick the lowest
    // non-null lowest_quoted_price; rows where lowest_quoted_price is null
    // sort to the end.
    const sorted = [...mappings].sort((a, b) => {
      const ap = a.lowest_quoted_price as number | null
      const bp = b.lowest_quoted_price as number | null
      if (ap == null && bp == null) return 0
      if (ap == null) return 1
      if (bp == null) return -1
      return ap - bp
    })
    const winner = sorted[0]

    await logAudit(supabase, endpoint, req, queryParams, 'found', Date.now() - start, null)

    return NextResponse.json({
      found: true,
      customer: customerName,
      internal_pn: winner.internal_part_number,
      cust_pn: winner.customer_part_number,
      category: winner.category,
      lowest_price: winner.lowest_quoted_price,
      variable_cost: winner.variable_cost,
      total_cost: winner.total_cost,
      sales_target: winner.sales_target,
      contribution_status: winner.contribution_level,
      queried_at: queriedAt,
    })
  } catch (err) {
    const requestId = randomUUID()
    const message = err instanceof Error ? err.message : 'unknown'
    console.error(`[price-lookup] db error (request_id=${requestId}): ${message}`)
    await logAudit(supabase, endpoint, req, queryParams, 'server_error', Date.now() - start, message)
    return NextResponse.json(
      { error: 'Internal server error', request_id: requestId },
      { status: 500 },
    )
  }
}

async function methodNotAllowed(req: NextRequest): Promise<NextResponse> {
  const start = Date.now()
  // Best-effort audit; failure here is non-fatal.
  try {
    const supabase = getAnonClient()
    const url = new URL(req.url)
    await logAudit(
      supabase,
      '/api/price-lookup',
      req,
      {
        customer: url.searchParams.get('customer'),
        internal_pn: url.searchParams.get('internal_pn'),
      },
      'method_not_allowed',
      Date.now() - start,
      `method=${req.method}`,
    )
  } catch {
    // ignored — we still need to return 405 even if audit can't initialize.
  }
  return NextResponse.json(
    { error: 'Method not allowed. Use GET.' },
    { status: 405, headers: { Allow: 'GET' } },
  )
}

export const POST = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
