import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

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
