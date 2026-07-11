/**
 * MCP server endpoint — stateless Streamable HTTP (JSON responses, no SSE).
 * Speaks the MCP JSON-RPC subset remote clients need: initialize, ping,
 * tools/list, tools/call, plus notification acks. One deployment serves
 * Gemini, ChatGPT, Grok, and Claude connectors.
 *
 * Auth: Bearer JWT minted by /api/mcp-oauth/token. Every request re-checks the
 * global kill switch AND the caller's mcp_access row, so revocation in User
 * Management takes effect immediately — not at token expiry. Every tools/call
 * (and every rejected request) lands in mcp_request_log.
 */
import { NextRequest, NextResponse } from "next/server"
import { verifyAccessToken, type McpTokenClaims } from "@/lib/mcp/crypto"
import { getMcpAccessByUserId, logMcpRequest, mcpGloballyEnabled } from "@/lib/mcp/store"
import { MCP_TOOLS, toolsForAccessLevel } from "@/lib/mcp/tools"
import { CORS_HEADERS, corsPreflight } from "@/lib/mcp/oauth-metadata"
import { requestOrigin } from "@/lib/mcp/base-url"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const DEFAULT_PROTOCOL_VERSION = "2025-06-18"

const SERVER_INFO = {
  name: "entech-molding-dashboard",
  title: "Entech Molding Dashboard",
  version: "1.0.0",
}

type JsonRpcId = string | number | null

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function unauthorized(req: NextRequest, detail: string): NextResponse {
  const metadataUrl = `${requestOrigin(req)}/.well-known/oauth-protected-resource/api/mcp`
  return new NextResponse(JSON.stringify({ error: "unauthorized", error_description: detail }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      // RFC 9728: point the client at the resource metadata so it can discover
      // the authorization server and start the OAuth flow.
      "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="${detail}"`,
    },
  })
}

async function authenticate(
  req: NextRequest
): Promise<{ claims: McpTokenClaims; accessLevel: string } | NextResponse> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorized(req, "Missing Bearer token")
  }
  const claims = verifyAccessToken(authHeader.slice(7))
  if (!claims) {
    await logMcpRequest({ method: "auth", ok: false, error: "invalid_token" })
    return unauthorized(req, "Invalid or expired token")
  }
  if (!(await mcpGloballyEnabled())) {
    await logMcpRequest({
      email: claims.email,
      user_id: claims.sub,
      client_id: claims.client_id,
      method: "auth",
      ok: false,
      error: "globally_disabled",
    })
    return unauthorized(req, "MCP access is currently disabled")
  }
  const access = await getMcpAccessByUserId(claims.sub)
  if (!access || !access.enabled) {
    await logMcpRequest({
      email: claims.email,
      user_id: claims.sub,
      client_id: claims.client_id,
      method: "auth",
      ok: false,
      error: "access_revoked",
    })
    return unauthorized(req, "MCP access has been revoked")
  }
  // Live access level from the DB wins over whatever was in the token.
  return { claims, accessLevel: access.scope }
}

async function handleRpc(
  message: Record<string, unknown>,
  claims: McpTokenClaims,
  accessLevel: string
): Promise<Record<string, unknown> | null> {
  const method = typeof message.method === "string" ? message.method : ""
  const id = (message.id ?? null) as JsonRpcId
  const params = (message.params ?? {}) as Record<string, unknown>
  const isNotification = message.id === undefined

  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "Read-only view of Entech's molding production dashboard (orders, inventory, production, " +
          "shipping, BOM). Call dashboard_summary first to orient yourself. Quantities are raw ERPNext " +
          "unit counts; PO numbers are text, not numbers.",
      })
    }

    case "ping":
      return rpcResult(id, {})

    case "tools/list":
      return rpcResult(id, {
        tools: toolsForAccessLevel(accessLevel).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case "tools/call": {
      const toolName = typeof params.name === "string" ? params.name : ""
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const tool = MCP_TOOLS.find((t) => t.name === toolName)
      const started = Date.now()

      if (!tool || !tool.accessLevels.includes(accessLevel)) {
        await logMcpRequest({
          email: claims.email,
          user_id: claims.sub,
          client_id: claims.client_id,
          method,
          tool: toolName,
          args,
          ok: false,
          error: tool ? "tool_not_allowed_for_access_level" : "unknown_tool",
        })
        return rpcError(id, -32602, `Unknown tool: ${toolName}`)
      }

      try {
        const result = await tool.handler(args)
        await logMcpRequest({
          email: claims.email,
          user_id: claims.sub,
          client_id: claims.client_id,
          method,
          tool: toolName,
          args,
          ok: true,
          latency_ms: Date.now() - started,
        })
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        })
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "tool execution failed"
        await logMcpRequest({
          email: claims.email,
          user_id: claims.sub,
          client_id: claims.client_id,
          method,
          tool: toolName,
          args,
          ok: false,
          error: messageText.slice(0, 300),
          latency_ms: Date.now() - started,
        })
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${messageText}` }],
          isError: true,
        })
      }
    }

    default:
      // Notifications (notifications/initialized, notifications/cancelled, …)
      // are acknowledged silently; unknown requests get a method-not-found.
      if (isNotification || method.startsWith("notifications/")) return null
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof NextResponse) return auth
  const { claims, accessLevel } = auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), {
      status: 400,
      headers: CORS_HEADERS,
    })
  }

  // Streamable HTTP allows batches; respond in kind.
  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(
        body.map((m) => handleRpc(m as Record<string, unknown>, claims, accessLevel))
      )
    ).filter((r): r is Record<string, unknown> => r !== null)
    if (responses.length === 0) {
      return new NextResponse(null, { status: 202, headers: CORS_HEADERS })
    }
    return NextResponse.json(responses, { headers: CORS_HEADERS })
  }

  const response = await handleRpc(body as Record<string, unknown>, claims, accessLevel)
  if (response === null) {
    // Pure notification — acknowledge with 202/no body per Streamable HTTP.
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS })
  }
  return NextResponse.json(response, { headers: CORS_HEADERS })
}

// We don't offer a server-initiated SSE stream; 405 is the spec-sanctioned reply.
export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof NextResponse) return auth
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } })
}

export async function DELETE() {
  // Stateless server — nothing to delete; acknowledge session teardown.
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return corsPreflight()
}
