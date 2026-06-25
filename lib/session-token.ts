"use client"

import { supabase } from "./supabase"
import { getDeviceToken } from "./device-auth"

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

// Synchronously read the access token straight out of the persisted Supabase
// session in localStorage. supabase-js stores it under `sb-<ref>-auth-token`;
// we scan rather than reconstruct the key so we don't depend on the project
// ref. This closes the first-paint race: a data fetch that fires on mount
// (before the async getSession below resolves) still gets a token. The token
// could be stale if the tab was closed >1h, but getSession()/onAuthStateChange
// refresh it within ms, so this strictly improves on sending nothing.
function readTokenFromStorage(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        const token = parsed?.access_token ?? parsed?.currentSession?.access_token
        if (token) return token as string
      }
    }
  } catch {
    // storage blocked / malformed — fall back to the async path below
  }
  return null
}

if (typeof window !== "undefined") {
  // Prime synchronously so authHeaders() works on the very first render...
  cachedToken = readTokenFromStorage()
  // ...revalidate from the SDK (refreshes an expired token)...
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
  // Shared floor devices have no Bearer token; send their device token so
  // device-aware routes (requireUserOrDevice, e.g. label printing) authenticate.
  // Harmless on user-only routes — they ignore it.
  const deviceToken = getDeviceToken()
  if (deviceToken) headers["x-device-token"] = deviceToken
  return headers
}
