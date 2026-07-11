/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591) for MCP clients.
 * Public by design — Gemini/ChatGPT/Grok/Claude self-register before the user
 * ever sees the consent screen. Registration grants NOTHING by itself: every
 * token still requires an approved dashboard user to pass the consent flow.
 */
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { CORS_HEADERS, corsPreflight, MCP_OAUTH_SCOPE } from "@/lib/mcp/oauth-metadata"

export const dynamic = "force-dynamic"

const MAX_REDIRECT_URIS = 10
const MAX_NAME_LENGTH = 120
// Abuse backstop for the (spec-mandated) unauthenticated endpoint: identical
// re-registrations are answered idempotently, clients that never earned a
// token get swept after 7 days, and past the hard cap we refuse outright.
// Only a handful of real connectors (Gemini/ChatGPT/Grok/Claude per user)
// ever register, so 200 is generous.
const MAX_CLIENTS = 200

function isAcceptableRedirectUri(uri: string): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.protocol === "https:") return true
  // Loopback redirect URIs are allowed for native clients / MCP Inspector.
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON" },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : []
  if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return NextResponse.json(
      { error: "invalid_redirect_uri", error_description: "redirect_uris required (1-10 entries)" },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  for (const uri of redirectUris) {
    if (!isAcceptableRedirectUri(uri)) {
      return NextResponse.json(
        { error: "invalid_redirect_uri", error_description: `Unacceptable redirect_uri: ${uri}` },
        { status: 400, headers: CORS_HEADERS }
      )
    }
  }

  const clientName =
    typeof body.client_name === "string" ? body.client_name.slice(0, MAX_NAME_LENGTH) : null

  // Idempotent re-registration: same name + same redirect_uris → same client.
  const { data: existing } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris, created_at")
    .eq("client_name", clientName ?? "")
    .limit(50)
  const match = (existing ?? []).find(
    (c) => JSON.stringify(c.redirect_uris) === JSON.stringify(redirectUris)
  )
  if (match) {
    return NextResponse.json(
      {
        client_id: match.client_id,
        client_name: clientName,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: MCP_OAUTH_SCOPE,
        client_id_issued_at: Math.floor(new Date(match.created_at).getTime() / 1000),
      },
      { status: 201, headers: CORS_HEADERS }
    )
  }

  // Sweep clients that registered >7 days ago but never produced a code
  // (mcp_oauth_codes cascades on client delete; consented clients keep rows).
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stale } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .select("client_id, mcp_oauth_codes(code_hash)")
    .lt("created_at", cutoff)
    .limit(50)
  const sweep = (stale ?? [])
    .filter((c) => !c.mcp_oauth_codes || c.mcp_oauth_codes.length === 0)
    .map((c) => c.client_id)
  if (sweep.length > 0) {
    await supabaseAdmin.from("mcp_oauth_clients").delete().in("client_id", sweep)
  }

  const { count } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .select("client_id", { count: "exact", head: true })
  if ((count ?? 0) >= MAX_CLIENTS) {
    return NextResponse.json(
      { error: "server_error", error_description: "Registration limit reached" },
      { status: 429, headers: CORS_HEADERS }
    )
  }

  const { data, error } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .insert({
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
    })
    .select("client_id, created_at")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: "server_error", error_description: "Registration failed" },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  return NextResponse.json(
    {
      client_id: data.client_id,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: MCP_OAUTH_SCOPE,
      client_id_issued_at: Math.floor(new Date(data.created_at).getTime() / 1000),
    },
    { status: 201, headers: CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return corsPreflight()
}
