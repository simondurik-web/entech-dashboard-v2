import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

export const maxDuration = 180

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const PHIL_PATH = "/phil-assistant"
const WEBHOOK_URL = process.env.PHIL_AI_WEBHOOK_URL
const WEBHOOK_SECRET = process.env.PHIL_AI_WEBHOOK_SECRET
const WEBHOOK_TIMEOUT_MS = 150_000

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
  return {
    userId: profile.id,
    email: profile.email,
    role: profile.role ?? "visitor",
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

export async function POST(req: NextRequest) {
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

  let body: IncomingBody
  try {
    body = (await req.json()) as IncomingBody
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const question = typeof body.question === "string" ? body.question.trim() : ""
  if (question.length < 1 || question.length > 2000) {
    return NextResponse.json({ error: "bad_question" }, { status: 400 })
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0
    ? body.sessionId
    : crypto.randomUUID()

  const language: "en" | "es" = body.language === "es" ? "es" : "en"

  // Fetch recent history for this session (chronological, last 20 messages)
  const { data: historyRows } = await supabaseAdmin
    .from("phil_chat_history")
    .select("role, content")
    .eq("user_id", user.userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(20)

  const history = (historyRows ?? []).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content as string,
  }))

  // Persist user message before calling bridge
  await supabaseAdmin.from("phil_chat_history").insert({
    user_id: user.userId,
    session_id: sessionId,
    role: "user",
    content: question,
  })

  const result = await callBridge({
    question,
    history,
    language,
    user: { email: user.email, role: user.role },
  })

  if (!result.ok) {
    await supabaseAdmin.from("phil_chat_history").insert({
      user_id: user.userId,
      session_id: sessionId,
      role: "assistant",
      content: "",
      error: result.detail,
    })
    return NextResponse.json(
      { error: "bridge_failed", detail: result.detail, sessionId },
      { status: result.status },
    )
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

  return NextResponse.json({
    answer,
    report: report ?? null,
    model: model ?? "gpt-5.5",
    latencyMs: latencyMs ?? null,
    sessionId,
  })
}

// GET /api/chat/phil?sessionId=... — fetch history for current user (current session if provided, else most recent session)
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
