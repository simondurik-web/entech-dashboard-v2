import { authHeaders } from "@/lib/session-token"

export function toFiniteOrNull(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (!raw || raw.trim() === "") return { ok: true, value: null }
  const n = Number(raw.replace(",", ".").trim())
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
}

export function toIntOrNull(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (!raw || raw.trim() === "") return { ok: true, value: null }
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }
}

/**
 * Request headers for the Quality + Pallet Records APIs.
 *
 * Hardened 2026-07-27: used to send `x-user-id: <profile.id>`, which the server
 * trusted as identity — anyone could set that header to a known user's UUID and
 * act as them (verified against production: the admin-only pallet user list and
 * the quality product list both returned 200 to a spoofed header). Now it sends
 * the verified Supabase Bearer token, exactly like the rest of the dashboard,
 * plus the floor-device token when there is no user session.
 *
 * The `userId` parameter is retained so the ~20 call sites keep compiling, but
 * it is deliberately unused: identity must come from the token, never the
 * caller. Do not reintroduce it.
 */
export function userHeaders(_userId?: string | null): HeadersInit {
  return authHeaders({ "Content-Type": "application/json" })
}
