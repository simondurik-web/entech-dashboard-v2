import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "crypto"

export type AuthedUser = { id: string; email: string | null }

/**
 * Derive the caller's identity from the verified Supabase Bearer JWT.
 *
 * This is the hardened replacement for the old `req.headers.get("x-user-id")`
 * pattern, which trusted a browser-supplied header — anyone who knew an
 * enrolled user's UUID could spoof it and act as them. The id/email returned
 * here are verified by Supabase Auth (`auth.getUser(token)`) and cannot be
 * forged by the client.
 *
 * Returns `null` when no valid Bearer token is present (no header, malformed
 * token, or token rejected by Supabase). Callers that previously did
 * `if (!userId) return 401` keep that exact behavior by using `(await
 * requireUser(req))?.id` and leaving their null-check in place.
 *
 * Mirrors `getUserFromRequest` in app/api/auth/profile/route.ts (the one route
 * that already did this correctly); centralized so every protected route shares
 * one implementation.
 */
export async function requireUser(req: NextRequest): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice(7)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return { id: user.id, email: user.email ?? null }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Like {@link requireUser}, but ALSO accepts a trusted server-to-server caller
 * that presents the shared automation key in the `x-service-key` header
 * (compared in constant time against `PO_AUTOMATION_API_KEY`).
 *
 * Used by the PO automation scripts that run with NO Supabase user session —
 * currently the BOL / PO-PDF auto-uploaders `release_toter.py` and
 * `attach_po_pdf.py`, which POST to /api/po-automation/documents. For a valid
 * service call, attribution falls back to the `x-user-id` header — which is
 * safe HERE because it is gated behind the secret key (a browser cannot set a
 * valid `x-service-key`), unlike the bare `x-user-id` trust this hardening
 * removed everywhere else.
 *
 * If the service key is absent/invalid, this is exactly `requireUser` (Bearer
 * JWT), so normal users are unaffected.
 */
export async function requireUserOrService(req: NextRequest): Promise<AuthedUser | null> {
  const expected = process.env.PO_AUTOMATION_API_KEY
  const provided = req.headers.get("x-service-key")
  if (expected && provided && safeEqual(provided, expected)) {
    const uid = req.headers.get("x-user-id")
    return { id: uid || "po-automation-service", email: null }
  }
  return requireUser(req)
}
