/**
 * OAuth token endpoint for MCP clients (public clients, PKCE mandatory).
 *
 * grant_type=authorization_code: single-use code (stored hashed) + S256 PKCE
 * verifier → 1h JWT access token + rotating refresh token (stored hashed).
 * grant_type=refresh_token: rotate — old token revoked, new pair issued.
 *
 * Every grant re-checks mcp_access AND the global kill switch, so disabling a
 * user (or the feature) cuts off new tokens immediately; access tokens die
 * within the hour and every /api/mcp call re-checks access anyway.
 */
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import {
  pkceChallengeFromVerifier,
  randomToken,
  sha256,
  signAccessToken,
} from "@/lib/mcp/crypto"
import { getMcpAccessByUserId, mcpGloballyEnabled } from "@/lib/mcp/store"
import { CORS_HEADERS, corsPreflight, MCP_OAUTH_SCOPE } from "@/lib/mcp/oauth-metadata"
import { requestOrigin } from "@/lib/mcp/base-url"

export const dynamic = "force-dynamic"

const ACCESS_TOKEN_TTL_S = 60 * 60 // 1 hour
const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60 // 30 days

function tokenError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: CORS_HEADERS }
  )
}

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const json = await req.json().catch(() => ({}))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(json)) if (typeof v === "string") out[k] = v
    return out
  }
  const text = await req.text().catch(() => "")
  return Object.fromEntries(new URLSearchParams(text))
}

async function issueTokens(req: NextRequest, grant: {
  user_id: string
  email: string
  client_id: string
  access_level: string
}) {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = signAccessToken({
    iss: requestOrigin(req),
    aud: "mcp",
    sub: grant.user_id,
    email: grant.email,
    scope: MCP_OAUTH_SCOPE,
    access_level: grant.access_level,
    client_id: grant.client_id,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_S,
  })

  const refreshToken = randomToken(32)
  const { error } = await supabaseAdmin.from("mcp_oauth_tokens").insert({
    token_hash: sha256(refreshToken),
    client_id: grant.client_id,
    user_id: grant.user_id,
    email: grant.email,
    scope: grant.access_level,
    expires_at: new Date((now + REFRESH_TOKEN_TTL_S) * 1000).toISOString(),
  })
  if (error) throw new Error(`refresh token insert failed: ${error.message}`)

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: MCP_OAUTH_SCOPE,
    },
    { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  )
}

export async function POST(req: NextRequest) {
  if (!(await mcpGloballyEnabled())) {
    return tokenError("invalid_grant", "MCP access is currently disabled", 403)
  }

  const body = await parseBody(req)
  const grantType = body.grant_type

  if (grantType === "authorization_code") {
    const { code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: redirectUri } = body
    if (!code || !codeVerifier || !clientId) {
      return tokenError("invalid_request", "code, code_verifier and client_id are required")
    }

    const codeHash = sha256(code)
    const { data: row } = await supabaseAdmin
      .from("mcp_oauth_codes")
      .select("*")
      .eq("code_hash", codeHash)
      .single()

    if (!row) return tokenError("invalid_grant", "Unknown authorization code")
    if (row.used) {
      // Replayed code → revoke everything minted from it (RFC 6749 §4.1.2).
      await supabaseAdmin
        .from("mcp_oauth_tokens")
        .update({ revoked: true })
        .eq("client_id", row.client_id)
        .eq("user_id", row.user_id)
      return tokenError("invalid_grant", "Authorization code already used")
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return tokenError("invalid_grant", "Authorization code expired")
    }
    if (row.client_id !== clientId) return tokenError("invalid_grant", "client_id mismatch")
    if (redirectUri && row.redirect_uri !== redirectUri) {
      return tokenError("invalid_grant", "redirect_uri mismatch")
    }
    if (pkceChallengeFromVerifier(codeVerifier) !== row.code_challenge) {
      return tokenError("invalid_grant", "PKCE verification failed")
    }

    // Burn the code BEFORE issuing — a concurrent replay must lose.
    const { data: burned } = await supabaseAdmin
      .from("mcp_oauth_codes")
      .update({ used: true })
      .eq("code_hash", codeHash)
      .eq("used", false)
      .select("code_hash")
    if (!burned || burned.length === 0) {
      return tokenError("invalid_grant", "Authorization code already used")
    }

    const access = await getMcpAccessByUserId(row.user_id)
    if (!access || !access.enabled) {
      return tokenError("invalid_grant", "MCP access has been revoked for this user", 403)
    }

    return issueTokens(req, {
      user_id: row.user_id,
      email: row.email,
      client_id: row.client_id,
      access_level: access.scope,
    })
  }

  if (grantType === "refresh_token") {
    const { refresh_token: refreshToken, client_id: clientId } = body
    if (!refreshToken) return tokenError("invalid_request", "refresh_token is required")

    const tokenHash = sha256(refreshToken)
    const { data: row } = await supabaseAdmin
      .from("mcp_oauth_tokens")
      .select("*")
      .eq("token_hash", tokenHash)
      .single()

    if (!row || row.revoked) return tokenError("invalid_grant", "Invalid refresh token")
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return tokenError("invalid_grant", "Refresh token expired")
    }
    if (clientId && row.client_id !== clientId) {
      return tokenError("invalid_grant", "client_id mismatch")
    }

    const access = await getMcpAccessByUserId(row.user_id)
    if (!access || !access.enabled) {
      await supabaseAdmin.from("mcp_oauth_tokens").update({ revoked: true }).eq("token_hash", tokenHash)
      return tokenError("invalid_grant", "MCP access has been revoked for this user", 403)
    }

    // Rotate: revoke the presented token before minting its replacement.
    const { data: rotated } = await supabaseAdmin
      .from("mcp_oauth_tokens")
      .update({ revoked: true })
      .eq("token_hash", tokenHash)
      .eq("revoked", false)
      .select("token_hash")
    if (!rotated || rotated.length === 0) {
      return tokenError("invalid_grant", "Invalid refresh token")
    }

    return issueTokens(req, {
      user_id: row.user_id,
      email: row.email,
      client_id: row.client_id,
      access_level: access.scope,
    })
  }

  return tokenError("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "(none)"}`)
}

export async function OPTIONS() {
  return corsPreflight()
}
