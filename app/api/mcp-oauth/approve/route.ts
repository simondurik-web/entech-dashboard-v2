/**
 * Consent backend for /mcp/authorize.
 *
 * GET  ?client_id&redirect_uri → validates the pair and returns the client
 *      name + whether the signed-in user may connect (drives the consent UI).
 * POST { client_id, redirect_uri, state, code_challenge, … } → requires a
 *      verified dashboard Bearer token; mints a 10-minute single-use
 *      authorization code and returns the redirect URL to send the user back
 *      to the AI app.
 */
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireUser } from "@/lib/require-user"
import { randomToken, sha256 } from "@/lib/mcp/crypto"
import { getClient, getMcpAccessByUserId, logMcpRequest, mcpGloballyEnabled } from "@/lib/mcp/store"
import { MCP_OAUTH_SCOPE } from "@/lib/mcp/oauth-metadata"

export const dynamic = "force-dynamic"

const CODE_TTL_MS = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id") ?? ""
  const redirectUri = req.nextUrl.searchParams.get("redirect_uri") ?? ""

  if (!(await mcpGloballyEnabled())) {
    return NextResponse.json({ valid: false, reason: "disabled" })
  }
  const client = await getClient(clientId)
  if (!client) return NextResponse.json({ valid: false, reason: "unknown_client" })
  if (!client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json({ valid: false, reason: "redirect_uri_not_registered" })
  }

  // Access info is only revealed to a signed-in dashboard user.
  const user = await requireUser(req)
  let allowed: boolean | null = null
  if (user) {
    const access = await getMcpAccessByUserId(user.id)
    allowed = access?.enabled === true
  }

  return NextResponse.json({
    valid: true,
    client_name: client.client_name ?? "AI assistant",
    allowed,
  })
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await mcpGloballyEnabled())) {
    return NextResponse.json({ error: "MCP access is currently disabled" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const clientId = typeof body.client_id === "string" ? body.client_id : ""
  const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : ""
  const state = typeof body.state === "string" ? body.state : ""
  const codeChallenge = typeof body.code_challenge === "string" ? body.code_challenge : ""
  const codeChallengeMethod =
    typeof body.code_challenge_method === "string" ? body.code_challenge_method : "S256"

  const client = await getClient(clientId)
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 400 })
  if (!client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json({ error: "redirect_uri not registered for this client" }, { status: 400 })
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "PKCE S256 code_challenge is required" }, { status: 400 })
  }

  const access = await getMcpAccessByUserId(user.id)
  if (!access || !access.enabled) {
    await logMcpRequest({
      email: user.email,
      user_id: user.id,
      client_id: clientId,
      method: "oauth/approve",
      ok: false,
      error: "no_mcp_access",
    })
    return NextResponse.json(
      { error: "Your account does not have MCP access. Ask an admin to enable it in User Management." },
      { status: 403 }
    )
  }

  const code = randomToken(32)
  const { error } = await supabaseAdmin.from("mcp_oauth_codes").insert({
    code_hash: sha256(code),
    client_id: clientId,
    user_id: user.id,
    email: access.email,
    scope: MCP_OAUTH_SCOPE,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) {
    return NextResponse.json({ error: "Failed to create authorization code" }, { status: 500 })
  }

  await logMcpRequest({
    email: access.email,
    user_id: user.id,
    client_id: clientId,
    method: "oauth/approve",
    ok: true,
  })

  const redirect = new URL(redirectUri)
  redirect.searchParams.set("code", code)
  if (state) redirect.searchParams.set("state", state)
  return NextResponse.json({ redirect: redirect.toString() })
}
