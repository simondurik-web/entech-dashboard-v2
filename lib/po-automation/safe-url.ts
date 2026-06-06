/**
 * Only allow https URLs hosted on Supabase storage to be embedded/loaded
 * (rejects data:/blob:/http: and off-host URLs). Shared by every PO-automation
 * surface that renders DB-sourced document/screenshot URLs so the allowlist
 * cannot drift between callers and silently reintroduce an XSS/unsafe-link gap.
 */
export function isSafeStorageUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.supabase.co')
  } catch {
    return false
  }
}
