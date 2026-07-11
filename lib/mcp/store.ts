/**
 * DB access for the MCP OAuth layer + audit log. All reads/writes go through
 * supabaseAdmin — the mcp_* tables have RLS enabled with no policies, so the
 * anon/authenticated PostgREST roles see nothing.
 */
import { supabaseAdmin } from "@/lib/supabase-admin"

export type McpAccessLevel = "full_read" | "production_only" | "financial"

export interface McpAccess {
  user_id: string
  email: string
  enabled: boolean
  scope: McpAccessLevel
}

/** Global kill switch — row id=1 in mcp_settings. Fail closed on error. */
export async function mcpGloballyEnabled(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("mcp_settings")
    .select("enabled")
    .eq("id", 1)
    .single()
  if (error) return false
  return data?.enabled === true
}

export async function getMcpAccessByUserId(userId: string): Promise<McpAccess | null> {
  const { data } = await supabaseAdmin
    .from("mcp_access")
    .select("user_id, email, enabled, scope")
    .eq("user_id", userId)
    .single()
  return (data as McpAccess) ?? null
}

export interface McpOAuthClient {
  client_id: string
  client_name: string | null
  redirect_uris: string[]
}

export async function getClient(clientId: string): Promise<McpOAuthClient | null> {
  // Non-UUID client_id would make PostgREST error out — treat as not found.
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return null
  const { data } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .single()
  if (!data) return null
  return {
    client_id: data.client_id,
    client_name: data.client_name,
    redirect_uris: Array.isArray(data.redirect_uris) ? data.redirect_uris : [],
  }
}

export async function logMcpRequest(entry: {
  email?: string | null
  user_id?: string | null
  client_id?: string | null
  method: string
  tool?: string | null
  args?: unknown
  ok: boolean
  error?: string | null
  latency_ms?: number | null
}): Promise<void> {
  // Audit insert is awaited (fire-and-forget writes have bitten this codebase
  // before) but never allowed to fail the request itself.
  try {
    await supabaseAdmin.from("mcp_request_log").insert({
      email: entry.email ?? null,
      user_id: entry.user_id ?? null,
      client_id: entry.client_id ?? null,
      method: entry.method,
      tool: entry.tool ?? null,
      args: entry.args ?? null,
      ok: entry.ok,
      error: entry.error ?? null,
      latency_ms: entry.latency_ms ?? null,
    })
  } catch {
    // never block the request on logging
  }
}
