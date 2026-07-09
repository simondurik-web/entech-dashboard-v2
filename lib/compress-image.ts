/**
 * Client-side image compression for photo uploads.
 *
 * Photo uploads go through Vercel serverless routes, which reject request
 * bodies over ~4.5 MB with a plain-text 413 ("Request Entity Too Large").
 * Phone cameras routinely produce 5–12 MB photos, so anything user-shot
 * must be downscaled before it leaves the browser.
 */

const MAX_DIMENSION = 2200
const JPEG_QUALITY = 0.82
// Files at or below this size pass through untouched — already safely under
// the request cap, and recompressing them only loses quality.
const SKIP_BELOW_BYTES = 1_500_000

// Formats where canvas re-encoding would destroy the content (animation,
// vectors) — pass through and let the size guard at the call site decide.
const NON_COMPRESSIBLE = new Set(['image/gif', 'image/svg+xml'])

async function loadDrawable(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // imageOrientation: 'from-image' bakes EXIF rotation into the bitmap so
    // portrait phone photos don't come out sideways after re-encoding.
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Older Safari: fall back to an <img>, which modern engines also
    // EXIF-orient when drawn to a canvas.
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Image decode failed'))
      }
      img.src = url
    })
  }
}

/**
 * Downscale + re-encode an image file to JPEG so it fits comfortably under
 * the upload body limit. Fails open: any decode/encode problem returns the
 * original file rather than blocking the upload.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  try {
    if (!file.type.startsWith('image/') || NON_COMPRESSIBLE.has(file.type)) return file
    if (file.size <= SKIP_BELOW_BYTES) return file

    const source = await loadDrawable(file)
    const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
    const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
    if (!srcW || !srcH) return file

    const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(srcW * scale))
    canvas.height = Math.max(1, Math.round(srcH * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    if (source instanceof ImageBitmap) source.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    )
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/**
 * Read an error message out of an API response that may not be JSON.
 * Vercel's own rejections (413 and friends) are plain text — parsing them
 * as JSON is what produced the "Unexpected token 'R'" errors users saw.
 */
export async function readUploadError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null)
  if (data && typeof data.error === 'string') return data.error
  return `${fallback} (HTTP ${res.status})`
}
