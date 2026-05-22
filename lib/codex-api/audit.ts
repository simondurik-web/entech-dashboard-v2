import 'server-only'
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callerIp } from './auth'

export type AuditResult =
  | 'ok'
  | 'unauthorized'
  | 'bad_request'
  | 'validation_failed'
  | 'method_not_allowed'
  | 'query_error'
  | 'server_error'

export async function logCodexCall(
  endpoint: string,
  req: NextRequest,
  queryParams: Record<string, string | null | number | undefined>,
  result: AuditResult,
  responseTimeMs: number,
  errorMessage: string | null,
): Promise<void> {
  try {
    await supabaseAdmin.from('api_audit_log').insert({
      endpoint,
      caller_ip: callerIp(req),
      caller_user_agent: req.headers.get('user-agent'),
      query_params: queryParams,
      result,
      response_time_ms: responseTimeMs,
      error_message: errorMessage,
    })
  } catch {
    console.error(`[${endpoint}] audit log insert failed`)
  }
}
