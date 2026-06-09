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

export function userHeaders(userId: string | null | undefined): HeadersInit {
  return { "Content-Type": "application/json", "x-user-id": userId || "" }
}
