import { NextRequest } from "next/server"

/**
 * Absolute origin of the current deployment, derived from proxy headers so the
 * same code yields the right issuer/endpoints on staging, production, and
 * localhost. Vercel sets x-forwarded-host/proto authoritatively.
 */
export function requestOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000"
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}
