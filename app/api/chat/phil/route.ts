import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireUser } from "@/lib/require-user"

export const maxDuration = 800
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const PHIL_PATH = "/phil-assistant"
const DASHBOARD_APP_ID = "dashboard"
const HISTORY_LIMIT = 20
const KEEPALIVE_MS = 4_000

// Async job queue settings — bridge worker claims rows from phil_jobs and
// writes results back. Vercel route polls for completion. This decouples
// the chat latency from any wall-clock ceiling.
const JOB_POLL_INTERVAL_MS = 1_500
const JOB_MAX_WAIT_MS = 600_000  // 10 min absolute ceiling — safety net

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

  const effectiveRole = appRole?.role ?? "visitor"

  return {
    userId: profile.id,
    email: profile.email,
    role: effectiveRole,
    customPermissions: (profile.custom_permissions as Record<string, boolean> | null) ?? null,
  }
}

async function canAccessPhil(user: UserContext): Promise<boolean> {
  if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true
  // Blocked is a hard-deny — before custom_permissions can grant anything.
  if (user.role === "blocked") return false
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

async function enqueueJob(payload: {
  userId: string
  sessionId: string
  question: string
  history: Array<{ role: "user" | "assistant"; content: string }>
  language: "en" | "es"
  user: { email: string; role: string }
}): Promise<{ ok: true; jobId: string } | { ok: false; status: number; detail: string }> {
  const { data, error } = await supabaseAdmin
    .from("phil_jobs")
    .insert({
      user_id: payload.userId,
      session_id: payload.sessionId,
      question: payload.question,
      history: payload.history,
      language: payload.language,
      user_email: payload.user.email,
      user_role: payload.user.role,
      // status defaults to 'queued'
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    return { ok: false, status: 500, detail: error?.message?.slice(0, 200) ?? "enqueue_failed" }
  }
  return { ok: true, jobId: data.id as string }
}

interface JobRow {
  status: "queued" | "running" | "done" | "failed"
  result: BridgeResponse | null
  error: string | null
  claimed_by: string | null
}

async function fetchJob(jobId: string): Promise<JobRow | null> {
  const { data } = await supabaseAdmin
    .from("phil_jobs")
    .select("status, result, error, claimed_by")
    .eq("id", jobId)
    .single()
  return (data as JobRow | null) ?? null
}

interface IncomingBody {
  question?: unknown
  sessionId?: unknown
  language?: unknown
}

function sanitizeBridgeError(detail: string, status: number): string {
  const d = (detail ?? "").toLowerCase()
  if (status === 504 || d === "timeout" || d === "codex_timeout") return "timeout"
  if (status === 503 || d === "bridge_not_configured") return "bridge_not_configured"
  if (d === "empty_answer") return "empty_answer"
  if (status === 429) return "rate_limit"
  if (status === 401 || status === 403) return "bridge_unauthorized"
  if (d === "codex_error" || d === "codex_failed") return "bridge_error"
  if (d === "enqueue_failed" || d === "job_missing") return "bridge_error"
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
        const userId = (await requireUser(req))?.id
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

        // --- Enqueue async job ---
        const enq = await enqueueJob({
          userId: user.userId,
          sessionId,
          question,
          history,
          language,
          user: { email: user.email, role: user.role },
        })
        if (!enq.ok) {
          await supabaseAdmin.from("phil_chat_history").insert({
            user_id: user.userId,
            session_id: sessionId,
            role: "assistant",
            content: "",
            error: "enqueue_failed",
          })
          send("error", { detail: enq.detail, status: enq.status, sessionId, fatal: true })
          return
        }
        const jobId = enq.jobId
        send("status", { phase: "queued", sessionId, jobId })

        // --- Poll the job table until done/failed or hit the safety ceiling ---
        const startedAt = Date.now()
        let lastEmittedStatus: JobRow["status"] | null = null
        let job: JobRow | null = null
        while (true) {
          if (Date.now() - startedAt > JOB_MAX_WAIT_MS) {
            await supabaseAdmin.from("phil_chat_history").insert({
              user_id: user.userId,
              session_id: sessionId,
              role: "assistant",
              content: "",
              error: "timeout",
            })
            send("error", { detail: "timeout", status: 504, sessionId, fatal: true })
            return
          }
          await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS))
          job = await fetchJob(jobId)
          if (!job) {
            send("error", { detail: "job_missing", status: 500, sessionId, fatal: true })
            return
          }
          // Surface running transition as a status event (UI flips
          // "Loading prior conversation…" → "Querying the dashboard…").
          if (job.status !== lastEmittedStatus) {
            if (job.status === "running") send("status", { phase: "thinking", sessionId, jobId })
            lastEmittedStatus = job.status
          }
          if (job.status === "done" || job.status === "failed") break
        }

        if (job.status === "failed" || !job.result) {
          const sanitized = sanitizeBridgeError(job.error ?? "bridge_error", 502)
          await supabaseAdmin.from("phil_chat_history").insert({
            user_id: user.userId,
            session_id: sessionId,
            role: "assistant",
            content: "",
            error: sanitized,
          })
          send("error", { detail: sanitized, status: 502, sessionId, fatal: true })
          return
        }

        const { answer, report, model, latencyMs } = job.result

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
  const userId = (await requireUser(req))?.id
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
  const userId = (await requireUser(req))?.id
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
