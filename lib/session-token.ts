"use client"

import { supabase } from "./supabase"

// Module-level cache of the current Supabase access token.
//
// Why a cache instead of `await supabase.auth.getSession()` at each call site:
// many client header-builders are SYNCHRONOUS (useMemo bodies, custom hooks,
// inline `headers: {...}` objects). Making them async to fetch the token would
// ripple through every caller. The Supabase session lives in localStorage and
// is mirrored here, kept fresh by the auth listener below, so `authHeaders()`
// can stay synchronous.
//
// Shared floor devices (authorized_devices) have NO Supabase session, so the
// token stays null and `authHeaders()` omits Authorization — those routes then
// 401, which is correct: device sessions are read-only by construction.
let cachedToken: string | null = null

if (typeof window !== "undefined") {
  // Prime from the persisted session on first load...
  supabase.auth.getSession().then(({ data }) => {
    cachedToken = data.session?.access_token ?? null
  })
  // ...and keep it current across sign-in / refresh / sign-out.
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedToken = session?.access_token ?? null
  })
}

/** The current verified access token, or null when not signed in (e.g. device session). */
export function getAccessToken(): string | null {
  return cachedToken
}

/**
 * Build request headers carrying the Supabase Bearer token for the API auth
 * guards (`requireUser`). Merge in any extra headers (e.g. Content-Type).
 *
 * Replaces the old `{ 'x-user-id': user.id }` pattern — identity now comes from
 * the verified token, not a spoofable header.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  if (cachedToken) headers.Authorization = `Bearer ${cachedToken}`
  return headers
}
