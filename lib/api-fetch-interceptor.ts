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
        // Merge headers from the Request (if any) and the init override.
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        )
        if (!headers.has("authorization")) {
          const token = getAccessToken()
          if (token) headers.set("authorization", `Bearer ${token}`)
        }
        if (!headers.has("x-device-token")) {
          const deviceToken = getDeviceToken()
          if (deviceToken) headers.set("x-device-token", deviceToken)
        }

        if (input instanceof Request && !init) {
          // Rebuild the Request so the body/method/etc. are preserved.
          return originalFetch(new Request(input, { headers }))
        }
        return originalFetch(input, { ...init, headers })
      }
    } catch {
      // On any unexpected error, fall back to the untouched fetch.
    }
    return originalFetch(input as RequestInfo | URL, init)
  }
}
