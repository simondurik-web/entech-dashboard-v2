"use client"

import { getAccessToken } from "./session-token"
import { getDeviceToken } from "./device-auth"

// Global fetch interceptor: attaches the caller's auth credentials to EVERY
// same-origin `/api/` request, so the (many, scattered) client data fetches all
// authenticate without each call site having to opt in. This is what lets the
// read routes be gated server-side (Phase 2b) without editing ~100 fetch sites.
//
// Scope is deliberately tight:
//   - ONLY same-origin requests whose path starts with `/api/` are touched.
//     Cross-origin calls (Supabase, Google Drive, analytics) and Next's own
//     RSC/_next requests are left exactly as-is.
//   - It only ADDS the caller's own Bearer token (+ device token) and never
//     overrides an Authorization header a caller set explicitly (e.g. the
//     auth/profile upsert, or a service-key caller).
// No security downside: it forwards the user's own session token to our own API.

let installed = false

// Refresh the Supabase session and hand back the new access token, or null if
// there is nothing to refresh. Imported lazily so this module stays free of a
// static dependency on the supabase client (it is loaded very early, before
// AuthProvider mounts).
async function refreshAccessToken(): Promise<string | null> {
  try {
    const { supabase } = await import("./supabase")
    const { data } = await supabase.auth.refreshSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

function isSameOriginApi(url: string): boolean {
  try {
    if (url.startsWith("/api/")) return true
    const origin = window.location.origin
    return url.startsWith(origin + "/api/")
  } catch {
    return false
  }
}

export function installApiFetchInterceptor(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return
  installed = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : ""

      if (url && isSameOriginApi(url)) {
        // Build the final header set in precedence order so nothing is dropped:
        //   1) the original Request's headers (when input is a Request),
        //   2) the init override on top,
        //   3) our tokens, only if not already set by the caller.
        const headers = new Headers(input instanceof Request ? input.headers : undefined)
        if (init?.headers) {
          new Headers(init.headers).forEach((value, key) => headers.set(key, value))
        }
        if (!headers.has("authorization")) {
          const token = getAccessToken()
          if (token) headers.set("authorization", `Bearer ${token}`)
        }
        if (!headers.has("x-device-token")) {
          const deviceToken = getDeviceToken()
          if (deviceToken) headers.set("x-device-token", deviceToken)
        }
        // For both the (string, init) and (Request, init?) forms, passing the
        // original input plus an init carrying the merged headers preserves the
        // method/body (taken from input when init omits them).
        //
        // Retry once through a token refresh on 401. Gating the read routes on
        // 2026-07-27 created a new failure mode: pages that used to work
        // unauthenticated now go blank if the cached token has expired at first
        // paint. Doing it HERE rather than at each call site means every one of
        // the ~200 same-origin fetches recovers, instead of the three that
        // happened to get noticed (codex, review panel round 5).
        //
        // Only ONE retry, and only when the refresh actually produced a new
        // token, so a genuinely unauthorized caller still gets its 401 rather
        // than a retry loop.
        //
        // Replayed only for GET/HEAD. A 401 on a POST/PATCH/DELETE surfaces to
        // the caller instead of being silently re-sent under a different token —
        // the failure this exists to fix is a blank READ at first paint, and
        // quietly repeating a write is not worth that (codex, round 6).
        // Request-object inputs are excluded too: their body stream is consumed
        // by the first call, so a replay would throw rather than return the 401.
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
        const replayable = !(input instanceof Request) && (method === "GET" || method === "HEAD")
        return originalFetch(input, { ...init, headers }).then(async (res) => {
          if (res.status !== 401 || !replayable) return res
          // Only refresh credentials this interceptor supplied. If the caller
          // set its own Authorization (a service-key script, the profile
          // upsert), replacing it with the ambient session token would change
          // who the request is from (codex, round 6).
          const callerSetAuth = new Headers(init?.headers ?? undefined).has("authorization")
            || (input instanceof Request && input.headers.has("authorization"))
          if (callerSetAuth) return res
          const token = await refreshAccessToken()
          if (!token || token === headers.get("authorization")?.slice(7)) return res
          const retryHeaders = new Headers(headers)
          retryHeaders.set("authorization", `Bearer ${token}`)
          return originalFetch(input, { ...init, headers: retryHeaders })
        })
      }
    } catch {
      // On any unexpected error, fall back to the untouched fetch.
    }
    return originalFetch(input as RequestInfo | URL, init)
  }
}
