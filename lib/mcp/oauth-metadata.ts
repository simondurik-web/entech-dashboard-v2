import { NextRequest, NextResponse } from "next/server"
import { requestOrigin } from "./base-url"

export const MCP_OAUTH_SCOPE = "dashboard.read"

/** CORS headers for the public OAuth/MCP endpoints. Browser-based MCP clients
 *  fetch these cross-origin; everything sensitive is token-gated, and the
 *  metadata itself is public by design. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export function authorizationServerMetadata(req: NextRequest) {
  const origin = requestOrigin(req)
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/api/mcp-oauth/token`,
    registration_endpoint: `${origin}/api/mcp-oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_OAUTH_SCOPE],
  }
}

export function protectedResourceMetadata(req: NextRequest) {
  const origin = requestOrigin(req)
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [MCP_OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Entech Molding Dashboard",
  }
}

export function jsonWithCors(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}
