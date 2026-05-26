import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

export type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'no_key_configured' | 'missing' | 'invalid' }

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  const len = Math.max(aBuf.length, bBuf.length)
  const aPad = Buffer.alloc(len)
  const bPad = Buffer.alloc(len)
  aBuf.copy(aPad)
  bBuf.copy(bPad)
  const equal = timingSafeEqual(aPad, bPad)
  return equal && aBuf.length === bBuf.length
}

export function authorizeCodex(req: NextRequest): AuthResult {
  const expected = process.env.CODEX_READER_API_KEY
  if (!expected) return { ok: false, reason: 'no_key_configured' }
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/)
  if (!match) return { ok: false, reason: 'missing' }
  const provided = match[1].trim()
  if (!provided) return { ok: false, reason: 'missing' }
  return timingSafeStringEqual(provided, expected)
    ? { ok: true }
    : { ok: false, reason: 'invalid' }
}

export function callerIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}
