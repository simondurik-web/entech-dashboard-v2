import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

export const maxDuration = 300
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const PHIL_PATH = "/phil-assistant"
const DASHBOARD_APP_ID = "dashboard"
const HISTORY_LIMIT = 20
const WEBHOOK_URL = process.env.PHIL_AI_WEBHOOK_URL
const WEBHOOK_SECRET = process.env.PHIL_AI_WEBHOOK_SECRET
const WEBHOOK_TIMEOUT_MS = 280_000
const KEEPALIVE_MS = 4_000

interface BridgeResponse {
  answer: string
  report?: unknown
  model?: string
  latencyMs?: number
}

interface UserContext {
  userId: string
  email: string
  role: string
  customPermissions: Record<string, boolean> | null
}

async function loadUserContext(userId: string): Promise<UserContext | null> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email, role, custom_permissions")
    .eq("id", userId)
    .single()
  if (!profile?.email) return null

  const { data: appRole } = await supabaseAdmin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("app_id", DASHBOARD_APP_ID)
    .single()

  const effectiveRole = appRole?.role ?? profile.role ?? "visitor"

  return {
    userId: profile.id,
    email: profile.email,
    role: effectiveRole,
    customPermissions: (profile.custom_permissions as Record<string, boolean> | null) ?? null,
  }
}

async function canAccessPhil(user: UserContext): Promise<boolean> {
  if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true
  if (user.role === "admin" || user.role === "super_admin") return true
  if (user.customPermissions && PHIL_PATH in user.customPermissions) {
    return user.customPermissions[PHIL_PATH] === true
  }
  const { data: rolePerm } = await supabaseAdmin
    .from("role_permissions")
    .select("menu_access")
    .eq("role", user.role)
    .single()
  const menu = (rolePerm?.menu_access as Record<string, boolean> | undefined) ?? {}
  return menu[PHIL_PATH] === true
}

async function callBridge(payload: {
  question: string
  history: Array<{ role: "user" | "assistant"; content: string }>
  language: "en" | "es"
  user: { email: string; role: string }
}): Promise<
  | { ok: true; data: BridgeResponse }
  | { ok: false; status: number; detail: string }
> {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    return { ok: false, status: 503, detail: "bridge_not_configured" }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetch(`${WEBHOOK_URL.replace(/\/$/, "")}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Phil-Secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, status: res.status === 429 ? 429 : 502, detail: text.slice(0, 500) }
    }
    const data = (await res.json()) as BridgeResponse
    if (typeof data.answer !== "string" || !data.answer.trim()) {
      return { ok: false, status: 502, detail: "empty_answer" }
    }
    return { ok: true, data }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, detail: "timeout" }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 502, detail: message.slice(0, 500) }
  } finally {
    clearTimeout(timer)
  }
}

interface IncomingBody {
  question?: unknown
  sessionId?: unknown
  language?: unknown
}

function sanitizeBridgeError(detail: string, status: number): string {
  if (status === 504 || detail === "timeout" || detail === "codex_timeout") return "timeout"
  if (status === 503 || detail === "bridge_not_configured") return "bridge_not_configured"
  if (detail === "empty_answer") return "empty_answer"
  if (status === 429) return "rate_limit"
  if (status === 401 || status === 403) return "bridge_unauthorized"
  return "bridge_error"
}

// POST is SSE-streaming. The bridge call can take 30–90s on questions that
// need a query-on-demand loop; iOS Safari aborts a quiet fetch around 60s
// on cellular. By writing `: ping\n\n` comments every 4s we keep the
// connection visibly alive end-to-end. Final outcome arrives as a
// named SSE event (status/result/error) the client parses.
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          closed = true
        }
      }
      const send = (event: string, data: object) => {
        safeEnqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }
      const ping = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
      }, KEEPALIVE_MS)

      try {
        // Initial byte: open SSE channel and tell the client we got the request.
        // Critical for iOS Safari — sees data immediately, doesn't time out.
        send("open", { ts: Date.now() })

        // --- Auth ---
        const userId = req.headers.get("x-user-id")
        if (!userId) {
          send("error", { detail: "auth_required", status: 401, fatal: true })
          return
        }
        const user = await loadUserContext(userId)
        if (!user) {
          send("error", { detail: "auth_required", status: 401, fatal: true })
          return
        }
        if (!(await canAccessPhil(user))) {
          send("error", { detail: "forbidden", status: 403, fatal: true })
          return
        }

        // --- Body ---
        let body: IncomingBody
        try {
          body = (await req.json()) as IncomingBody
        } catch {
          send("error", { detail: "bad_request", status: 400, fatal: true })
          return
        }
        const question = typeof body.question === "string" ? body.question.trim() : ""
        if (question.length < 1 || question.length > 2000) {
          send("error", { detail: "bad_question", status: 400, fatal: true })
          return
        }
        const sessionId =
          typeof body.sessionId === "string" && body.sessionId.length > 0
            ? body.sessionId
            : crypto.randomUUID()
        const language: "en" | "es" = body.language === "es" ? "es" : "en"

        send("status", { phase: "loading_history", sessionId })

        // --- History + persist user message ---
        const { data: historyRows } = await supabaseAdmin
          .from("phil_chat_history")
          .select("role, content")
          .eq("user_id", user.userId)
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true })
          .limit(HISTORY_LIMIT)
        const history = (historyRows ?? []).map((row) => ({
          role: row.role as "user" | "assistant",
          content: row.content as string,
        }))

        await supabaseAdmin.from("phil_chat_history").insert({
          user_id: user.userId,
          session_id: sessionId,
          role: "user",
          content: question,
        })

        send("status", { phase: "thinking", sessionId })

        // --- Bridge call ---
        const result = await callBridge({
          question,
          history,
          language,
          user: { email: user.email, role: user.role },
        })

        if (!result.ok) {
          const sanitized = sanitizeBridgeError(result.detail, result.status)
          await supabaseAdmin.from("phil_chat_history").insert({
            user_id: user.userId,
            session_id: sessionId,
            role: "assistant",
            content: "",
            error: sanitized,
          })
          send("error", {
            detail: sanitized,
            status: result.status,
            sessionId,
            fatal: true,
          })
          return
        }

        const { answer, report, model, latencyMs } = result.data

        await supabaseAdmin.from("phil_chat_history").insert({
          user_id: user.userId,
          session_id: sessionId,
          role: "assistant",
          content: answer,
          model: model ?? "gpt-5.5",
          latency_ms: latencyMs ?? null,
          report: report ?? null,
        })

        send("result", {
          answer,
          report: report ?? null,
          model: model ?? "gpt-5.5",
          latencyMs: latencyMs ?? null,
          sessionId,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "internal_error"
        send("error", { detail: message.slice(0, 200), status: 500, fatal: true })
      } finally {
        clearInterval(ping)
        closed = true
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables proxy buffering (Nginx + similar) so chunks ship promptly.
      "X-Accel-Buffering": "no",
    },
  })
}

// GET /api/chat/phil?sessionId=... — fetch history for current user
export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id")
  if (!userId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 })
  }
  const user = await loadUserContext(userId)
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 })
  }
  if (!(await canAccessPhil(user))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  let sessionId = url.searchParams.get("sessionId")

  if (!sessionId) {
    const { data: latest } = await supabaseAdmin
      .from("phil_chat_history")
      .select("session_id")
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    sessionId = (latest?.session_id as string | undefined) ?? null
  }

  if (!sessionId) {
    return NextResponse.json({ sessionId: crypto.randomUUID(), messages: [] })
  }

  const { data: rows } = await supabaseAdmin
    .from("phil_chat_history")
    .select("id, role, content, report, model, latency_ms, error, created_at")
    .eq("user_id", user.userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })

  return NextResponse.json({ sessionId, messages: rows ?? [] })
}

// DELETE /api/chat/phil?sessionId=... — clear session (or all sessions if omitted)
export async function DELETE(req: NextRequest) {
  const userId = req.headers.get("x-user-id")
  if (!userId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 })
  }
  const user = await loadUserContext(userId)
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 })
  }
  if (!(await canAccessPhil(user))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const sessionId = url.searchParams.get("sessionId")

  const query = supabaseAdmin
    .from("phil_chat_history")
    .delete()
    .eq("user_id", user.userId)
  const { error } = sessionId
    ? await query.eq("session_id", sessionId)
    : await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
