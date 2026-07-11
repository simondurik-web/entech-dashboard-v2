/**
 * Crypto helpers for the MCP OAuth layer. HS256 JWTs via Node crypto — no new
 * dependencies. Access tokens are self-contained JWTs; authorization codes and
 * refresh tokens are opaque random strings stored only as SHA-256 hashes.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto"

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const b64urlJson = (obj: unknown): string => b64url(Buffer.from(JSON.stringify(obj)))

function secret(): string {
  const s = process.env.MCP_JWT_SECRET
  if (!s || s.length < 32) throw new Error("MCP_JWT_SECRET missing or too short")
  return s
}

export interface McpTokenClaims {
  iss: string
  aud: "mcp"
  sub: string // user_id
  email: string
  scope: string // OAuth scope (dashboard.read)
  access_level: string // mcp_access.scope at issue time (full_read | …)
  client_id: string
  iat: number
  exp: number
}

export function signAccessToken(claims: McpTokenClaims): string {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" })
  const payload = b64urlJson(claims)
  const sig = b64url(createHmac("sha256", secret()).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

export function verifyAccessToken(token: string): McpTokenClaims | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  const expected = b64url(createHmac("sha256", secret()).update(`${header}.${payload}`).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64").toString()) as McpTokenClaims
    if (claims.aud !== "mcp") return null
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null
    return claims
  } catch {
    return null
  }
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
export function pkceChallengeFromVerifier(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest())
}
