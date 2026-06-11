// Device-side data cache (Simon 2026-06-11: "cache the different tables in the
// background so the data is loading faster").
//
// Extends the profile/permissions pattern from lib/auth-context.tsx to the
// heavy table payloads (orders, inventory, inventory history, shipping
// overview). Pages paint instantly from the last-known data, then a network
// fetch revalidates and overwrites within ~1s — same stale-while-revalidate
// semantics the boot flow already uses for identity.
//
// Storage is the Cache Storage API, not localStorage: inventory history alone
// can be several MB, which would blow the ~5MB localStorage quota shared with
// the Supabase session. A small localStorage stamp tracks which user the
// cached data belongs to; a different user wipes it before anything reads.

const CACHE_NAME = "edv2-data-v1"
const OWNER_KEY = "edv2.datacache.owner.v1"
const PREFETCH_STAMP_KEY = "edv2.datacache.prefetchedAt.v1"
// Never paint data older than this, even if nothing fresher exists.
const MAX_AGE_MS = 24 * 60 * 60 * 1000
// Don't re-run the post-login prefetch on every hard page load.
const PREFETCH_MIN_INTERVAL_MS = 2 * 60 * 1000

type Envelope = { savedAt: number; data: unknown }

function cachesAvailable(): boolean {
  return typeof window !== "undefined" && "caches" in window
}

async function openCache(): Promise<Cache | null> {
  if (!cachesAvailable()) return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

/** Read a cached payload. Returns null on miss, expiry, or any storage error. */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const cache = await openCache()
  if (!cache) return null
  try {
    const res = await cache.match(key)
    if (!res) return null
    const envelope = (await res.json()) as Envelope
    if (!envelope || Date.now() - envelope.savedAt > MAX_AGE_MS) return null
    return envelope.data as T
  } catch {
    return null
  }
}

async function cachePutJson(key: string, data: unknown): Promise<void> {
  const cache = await openCache()
  if (!cache) return
  try {
    const envelope: Envelope = { savedAt: Date.now(), data }
    await cache.put(
      key,
      new Response(JSON.stringify(envelope), {
        headers: { "content-type": "application/json" },
      }),
    )
  } catch {
    // quota or storage blocked — cache is best-effort
  }
}

// Concurrent fetches for the same key (page mount racing the post-login
// prefetch) share one request.
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Fetch JSON from the network and store it in the device cache. Throws on
 * network failure or a non-ok response, mirroring the pages' existing
 * `if (!res.ok) throw` handling. `key` is the canonical cache key when the
 * URL carries cache-bust params (manual Refresh).
 */
export async function fetchJsonAndCache<T>(
  url: string,
  opts?: { init?: RequestInit; key?: string },
): Promise<T> {
  const key = opts?.key ?? url
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    const res = await fetch(url, opts?.init)
    if (!res.ok) throw new Error(`Request failed: ${url} (${res.status})`)
    const data = (await res.json()) as T
    void cachePutJson(key, data)
    return data
  })()

  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Stamp the cache with its owner. If a different user's data is on the
 * device (login switch without a clean sign-out), wipe it before any page
 * can paint it.
 */
export function setDataCacheOwner(userId: string): void {
  if (typeof window === "undefined") return
  try {
    const current = localStorage.getItem(OWNER_KEY)
    if (current && current !== userId) {
      void clearDataCache()
    }
    localStorage.setItem(OWNER_KEY, userId)
  } catch {
    // storage blocked — fall through; cache reads stay best-effort
  }
}

export async function clearDataCache(): Promise<void> {
  try {
    localStorage.removeItem(OWNER_KEY)
    localStorage.removeItem(PREFETCH_STAMP_KEY)
  } catch {
    // ignore
  }
  if (!cachesAvailable()) return
  try {
    await caches.delete(CACHE_NAME)
  } catch {
    // ignore
  }
}

// The heavy, broadly-visible payloads worth warming before the user navigates
// anywhere. Deliberately excludes permission-gated data (/api/inventory-costs)
// so nothing sensitive lands in a shared device's cache, and tiny payloads
// where a fetch on page mount is already fast.
const PREFETCH_URLS = [
  "/api/sheets",
  "/api/inventory",
  "/api/inventory-history",
]

/**
 * Fire-and-forget warm-up of the heavy endpoints after login. Runs at most
 * once per PREFETCH_MIN_INTERVAL_MS across hard page loads so rapid
 * navigation doesn't hammer the uncached /api/sheets route.
 */
export function prefetchHeavyData(): void {
  if (typeof window === "undefined") return
  try {
    const last = Number(localStorage.getItem(PREFETCH_STAMP_KEY) || 0)
    if (Date.now() - last < PREFETCH_MIN_INTERVAL_MS) return
    localStorage.setItem(PREFETCH_STAMP_KEY, String(Date.now()))
  } catch {
    // storage blocked — still prefetch, just without throttling
  }
  for (const url of PREFETCH_URLS) {
    fetchJsonAndCache(url).catch(() => {
      // warm-up only — pages fetch for themselves on mount
    })
  }
}
