/**
 * Server-side photo URL resolver.
 * Swaps Google Drive URLs → Supabase Storage public URLs using the photo_mappings table.
 * Falls back to the original Drive URL if no mapping exists.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Use service role to bypass RLS on photo_mappings
// Falls back gracefully if key is not configured
const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

// In-memory cache: drive_file_id → public_url (survives within a single serverless invocation)
let mappingCache: Map<string, string> | null = null
let cacheLoadedAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min

function extractDriveFileId(url: string): string | null {
  if (!url) return null
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m1) return m1[1]
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  const m3 = url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/)
  if (m3) return m3[1]
  return null
}

async function ensureCache(): Promise<Map<string, string>> {
  const now = Date.now()
  if (mappingCache && now - cacheLoadedAt < CACHE_TTL_MS) {
    return mappingCache
  }

  if (!supabaseAdmin) {
    console.warn('photo-resolver: SUPABASE_SERVICE_ROLE_KEY not set, skipping photo resolution')
    return mappingCache ?? new Map()
  }

  const { data, error } = await supabaseAdmin
    .from('photo_mappings')
    .select('drive_file_id, public_url')

  if (error) {
    console.error('Failed to load photo_mappings:', error.message)
    return mappingCache ?? new Map()
  }

  mappingCache = new Map()
  for (const row of data ?? []) {
    mappingCache.set(row.drive_file_id, row.public_url)
  }
  cacheLoadedAt = now
  return mappingCache
}

/**
 * Resolve a single Drive URL to a Supabase Storage URL.
 * Returns the original URL if no mapping found.
 */
export async function resolvePhotoUrl(driveUrl: string): Promise<string> {
  if (!driveUrl) return driveUrl
  // Already a Supabase URL — pass through
  if (driveUrl.includes('supabase.co/storage')) return driveUrl

  const fileId = extractDriveFileId(driveUrl)
  if (!fileId) return driveUrl

  const cache = await ensureCache()
  return cache.get(fileId) ?? driveUrl
}

/**
 * Resolve an array of Drive URLs to Supabase Storage URLs.
 */
export async function resolvePhotoUrls(driveUrls: string[]): Promise<string[]> {
  if (!driveUrls || driveUrls.length === 0) return []
  const cache = await ensureCache()
  return driveUrls.map((url) => {
    if (!url) return url
    if (url.includes('supabase.co/storage')) return url
    const fileId = extractDriveFileId(url)
    if (!fileId) return url
    return cache.get(fileId) ?? url
  })
}

/**
 * Resolve all photo URLs in an array of records.
 * Pass the key(s) that contain photo URLs.
 */
export async function resolveRecordPhotos<T extends Record<string, unknown>>(
  records: T[],
  photoKeys: string[] = ['photos'],
): Promise<T[]> {
  // Load cache once
  await ensureCache()

  return Promise.all(
    records.map(async (record) => {
      const resolved = { ...record }
      for (const key of photoKeys) {
        const val = record[key]
        if (Array.isArray(val)) {
          resolved[key] = await resolvePhotoUrls(val as string[]) as unknown as T[typeof key]
        } else if (typeof val === 'string') {
          resolved[key] = await resolvePhotoUrl(val) as unknown as T[typeof key]
        }
      }
      return resolved
    }),
  )
}
