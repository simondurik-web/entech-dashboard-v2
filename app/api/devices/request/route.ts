import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { supabaseAdmin } from "@/lib/supabase-admin"

// A device asking for access. Unauthenticated by design — the caller only
// learns its own pairing status, and approval requires an admin. The raw
// token never lands in the DB, only its hash.

const TOKEN_RE = /^[a-f0-9]{64}$/
// Backstop against scripted spam: stop accepting new pairing requests when
// this many are already pending. Real usage is one floor PC at a time.
const MAX_PENDING = 25

export async function POST(req: NextRequest) {
  let body: { token?: string; name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const token = body.token ?? ""
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 })
  }

  const tokenHash = createHash("sha256").update(token).digest("hex")
  const pairingCode = tokenHash.slice(0, 6).toUpperCase()

  // Same device asking again (page reload while pending) → current state.
  const { data: existing } = await supabaseAdmin
    .from("authorized_devices")
    .select("status, pairing_code")
    .eq("token_hash", tokenHash)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ status: existing.status, code: existing.pairing_code })
  }

  const { count } = await supabaseAdmin
    .from("authorized_devices")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")

  if ((count ?? 0) >= MAX_PENDING) {
    return NextResponse.json({ error: "Too many pending requests" }, { status: 429 })
  }

  const name = (body.name || "").toString().slice(0, 80).trim() || "Unnamed device"
  const { error } = await supabaseAdmin.from("authorized_devices").insert({
    token_hash: tokenHash,
    pairing_code: pairingCode,
    name,
    status: "pending",
    user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ status: "pending", code: pairingCode })
}
