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
import { KNOWLEDGE_BRIEF } from "@/lib/mcp/knowledge"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const DEFAULT_PROTOCOL_VERSION = "2025-06-18"
// Real MCP clients send batches of 1-3 messages; anything huge is abuse. Batch
// entries also run SEQUENTIALLY — each tool can scan whole tables, so a
// parallel fan-out would be a self-inflicted DoS on the shared database.
const MAX_BATCH_SIZE = 10

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
  message: unknown,
  claims: McpTokenClaims,
  accessLevel: string
): Promise<Record<string, unknown> | null> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid Request")
  }
  return handleRpcObject(message as Record<string, unknown>, claims, accessLevel)
}

async function handleRpcObject(
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
          "Read-only live view of Entech's molding production business. It covers ALL of: open orders " +
          "and backlog, order lookup by PO/IF/part, inventory and stock levels, low stock, what " +
          "production needs to make, staged/shipping status, ERP (ERPNext) fulfillment history, " +
          "BOM and costs, the customer list — plus describe_tables + run_query for free-form " +
          "read-only SQL when no curated tool fits, and business_context for full domain knowledge.\n\n" +
          KNOWLEDGE_BRIEF +
          "\n\nRULES:\n" +
          "1. NEVER tell the user data is unavailable without calling a tool first. If one tool returns " +
          "nothing, that means THAT FILTER matched nothing — not that the data is missing. Call " +
          "dashboard_summary or list_customers to see what actually exists, then retry.\n" +
          "2. Do not infer the scope of this server from whichever tool you called first. An inventory " +
          "result does NOT mean this server only has inventory — re-read your tool list.\n" +
          "3. If NO curated tool answers the question, call describe_tables then run_query with a " +
          "read-only SELECT — do not give up.\n" +
          "4. Customer names are matched loosely, but if unsure call list_customers for exact spellings.\n" +
          "5. Quantities are raw ERPNext unit counts (a '48-pack' item counts PACKS, never multiply by " +
          "pieces). PO numbers are text, not numbers. BOM costs are internal manufacturing costs, " +
          "never customer prices.",
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

  // Streamable HTTP allows batches; respond in kind (bounded + sequential —
  // see MAX_BATCH_SIZE).
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        rpcError(null, -32600, `Batch size must be 1-${MAX_BATCH_SIZE}`),
        { status: 400, headers: CORS_HEADERS }
      )
    }
    const responses: Record<string, unknown>[] = []
    for (const m of body) {
      const r = await handleRpc(m, claims, accessLevel)
      if (r !== null) responses.push(r)
    }
    if (responses.length === 0) {
      return new NextResponse(null, { status: 202, headers: CORS_HEADERS })
    }
    return NextResponse.json(responses, { headers: CORS_HEADERS })
  }

  const response = await handleRpc(body, claims, accessLevel)
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
