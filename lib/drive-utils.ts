/**
 * Google Drive URL utilities
 * Converts various Drive URL formats to displayable thumbnail/image URLs
 */

/**
 * Extract a Google Drive file ID from various URL formats:
 * - https://drive.google.com/file/d/FILEID/view
 * - https://drive.google.com/open?id=FILEID
 * - https://lh3.googleusercontent.com/d/FILEID
 * - https://drive.google.com/uc?id=FILEID
 */
export function extractDriveFileId(url: string): string | null {
  if (!url) return null

  // Pattern 1: /d/FILEID
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m1) return m1[1]

  // Pattern 2: id=FILEID
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]

  // Pattern 3: googleusercontent.com/d/FILEID
  const m3 = url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/)
  if (m3) return m3[1]

  return null
}

/**
 * Convert a Google Drive URL to a thumbnail URL at the given width
 * Falls back to original URL if not a recognized Drive format
 */
export function getDriveThumbUrl(url: string, size: number = 400): string {
  const fileId = extractDriveFileId(url)
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`
  }
  // Not a Drive URL — return as-is (might be a direct image URL)
  return url
}

/**
 * Get both thumbnail and full-size URLs for a photo
 */
export function getPhotoUrls(url: string): { thumb: string; full: string } {
  const fileId = extractDriveFileId(url)
  if (fileId) {
    return {
      thumb: `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`,
      full: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`,
    }
  }
  return { thumb: url, full: url }
}
