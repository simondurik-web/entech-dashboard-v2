'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, AlertCircle, Minus, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Camera QR scanner for pallet labels. Uses ZXing over getUserMedia, which works
// across Chrome/Android AND Safari on iPad/iPhone (the native BarcodeDetector API
// is not available on Safari, so we can't rely on it). The rear camera is
// requested via facingMode:'environment'. Loaded dynamically (ssr:false) so the
// scanner bundle never ships on first paint and browser APIs never run on the server.

const BASE32 = /[0-9A-HJKMNP-TV-Z]{3,12}/ // Crockford base32 (no I/L/O/U)

/** The label QR encodes the bare pallet code, but be tolerant: strip any ZPL
 *  mode prefix (e.g. "QA,") and keep the first run of valid code characters. */
function extractPalletCode(raw: string): string {
  const tail = raw.includes(',') ? raw.slice(raw.lastIndexOf(',') + 1) : raw
  const m = tail.toUpperCase().match(BASE32)
  return m ? m[0] : tail.trim().toUpperCase()
}

interface ZoomCaps {
  min: number
  max: number
  step: number
}

// Sniper-scope reticle overlay (pointer-events-none). White strokes + a dark
// drop-shadow so it reads on any camera background; red accents on the lower/right
// arms like a mil-dot scope. Purely cosmetic — it doesn't affect scanning.
function Reticle() {
  const ticks = [14, 26, 38, 50, 62, 74]
  const major = (i: number) => (i % 2 === 1 ? 7 : 4) // every other tick longer
  return (
    <svg
      viewBox="0 0 200 200"
      className="pointer-events-none absolute"
      style={{ width: 'min(80vmin, 460px)', height: 'min(80vmin, 460px)' }}
    >
      <defs>
        <filter id="rs" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#000" floodOpacity="0.8" />
        </filter>
      </defs>
      <g filter="url(#rs)" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.1" fill="none">
        <circle cx="100" cy="100" r="94" strokeWidth="1.6" />
        {/* crosshair with a small center gap */}
        <line x1="100" y1="8" x2="100" y2="92" />
        <line x1="100" y1="108" x2="100" y2="192" />
        <line x1="8" y1="100" x2="92" y2="100" />
        <line x1="108" y1="100" x2="192" y2="100" />
        {/* tick marks: top + left in white, bottom + right in red (mil-dot style) */}
        {ticks.map((d, i) => (
          <line key={`u${i}`} x1={100 - major(i)} y1={100 - d} x2={100 + major(i)} y2={100 - d} />
        ))}
        {ticks.map((d, i) => (
          <line key={`l${i}`} x1={100 - d} y1={100 - major(i)} x2={100 - d} y2={100 + major(i)} />
        ))}
      </g>
      <g filter="url(#rs)" stroke="#ff3b30" strokeOpacity="0.9" strokeWidth="1.1" fill="none">
        {ticks.map((d, i) => (
          <line key={`d${i}`} x1={100 - major(i)} y1={100 + d} x2={100 + major(i)} y2={100 + d} />
        ))}
        {ticks.map((d, i) => (
          <line key={`r${i}`} x1={100 + d} y1={100 - major(i)} x2={100 + d} y2={100 + major(i)} />
        ))}
      </g>
      {/* thick cardinal edge bars */}
      <g fill="#fff" filter="url(#rs)" fillOpacity="0.9">
        <rect x="96" y="0" width="8" height="14" />
        <rect x="96" y="186" width="8" height="14" />
        <rect x="0" y="96" width="14" height="8" />
        <rect x="186" y="96" width="14" height="8" />
      </g>
      <circle cx="100" cy="100" r="1.6" fill="#ff3b30" />
    </svg>
  )
}

export default function PalletScanner({
  onResult,
  onClose,
}: {
  onResult: (code: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [zoomCaps, setZoomCaps] = useState<ZoomCaps | null>(null)
  const [zoom, setZoom] = useState(1)

  const applyZoom = (value: number) => {
    const track = trackRef.current
    if (!track || !zoomCaps) return
    const v = Math.min(zoomCaps.max, Math.max(zoomCaps.min, value))
    setZoom(v)
    // `zoom` isn't in the standard MediaTrackConstraints type yet.
    track
      .applyConstraints({ advanced: [{ zoom: v }] } as unknown as MediaTrackConstraints)
      .catch(() => {})
  }

  useEffect(() => {
    let stopped = false
    let controls: { stop: () => void } | null = null

    ;(async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        const reader = new BrowserQRCodeReader()
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result) => {
            if (result && !stopped) {
              stopped = true
              controls?.stop()
              onResult(extractPalletCode(result.getText()))
            }
          }
        )
        if (stopped) {
          controls.stop()
          return
        }
        setStarting(false)
        // Surface the camera's optical/digital zoom if the device exposes it.
        const stream = videoRef.current?.srcObject as MediaStream | null
        const track = stream?.getVideoTracks?.()[0] ?? null
        trackRef.current = track
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: ZoomCaps }) | undefined
        if (caps?.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > (caps.zoom.min ?? 1)) {
          setZoomCaps({ min: caps.zoom.min ?? 1, max: caps.zoom.max, step: caps.zoom.step || 0.1 })
          setZoom(caps.zoom.min ?? 1)
        }
      } catch (e) {
        const name = (e as Error)?.name
        setError(
          name === 'NotAllowedError'
            ? t('inventoryOps.scanDenied')
            : name === 'NotFoundError'
              ? t('inventoryOps.scanNoCamera')
              : t('inventoryOps.scanError')
        )
        setStarting(false)
      }
    })()

    return () => {
      stopped = true
      controls?.stop()
    }
  }, [onResult, t])

  // Pinch-to-zoom (when the camera supports zoom).
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    if (!zoomCaps || e.touches.length !== 2) return
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    pinchRef.current = { dist: Math.hypot(dx, dy), zoom }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!zoomCaps || !pinchRef.current || e.touches.length !== 2) return
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    const dist = Math.hypot(dx, dy)
    const ratio = dist / pinchRef.current.dist
    applyZoom(pinchRef.current.zoom * ratio)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm font-medium">{t('inventoryOps.scanTitle')}</span>
        <button
          onClick={onClose}
          aria-label={t('inventoryOps.cancel')}
          className="rounded-full p-2 hover:bg-white/10"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {!error && <Reticle />}
        {starting && !error && (
          <div className="absolute flex items-center gap-2 text-sm text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('inventoryOps.scanStarting')}
          </div>
        )}
        {error && (
          <div className="mx-6 flex max-w-sm items-center gap-2 rounded-lg bg-white p-4 text-sm text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Zoom control (only when the camera exposes zoom). */}
      {!error && zoomCaps && (
        <div className="flex items-center gap-3 px-6 pt-2 text-white">
          <button
            onClick={() => applyZoom(zoom - (zoomCaps.step || 0.1) * 5)}
            aria-label={t('inventoryOps.zoomOut')}
            className="rounded-full bg-white/15 p-2 active:bg-white/30"
          >
            <Minus className="h-5 w-5" />
          </button>
          <input
            type="range"
            min={zoomCaps.min}
            max={zoomCaps.max}
            step={zoomCaps.step || 0.1}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-2 flex-1 accent-white"
            aria-label={t('inventoryOps.zoom')}
          />
          <button
            onClick={() => applyZoom(zoom + (zoomCaps.step || 0.1) * 5)}
            aria-label={t('inventoryOps.zoomIn')}
            className="rounded-full bg-white/15 p-2 active:bg-white/30"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}

      {!error && (
        <p className="p-4 text-center text-sm text-white/80">
          {t('inventoryOps.scanHint')}
          {zoomCaps ? ` ${t('inventoryOps.zoomHint')}` : ''}
        </p>
      )}
    </div>
  )
}
