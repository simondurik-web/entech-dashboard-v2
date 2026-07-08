'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, AlertCircle, Minus, Plus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Camera QR scanner for pallet labels. Uses ZXing over getUserMedia, which works
// across Chrome/Android AND Safari on iPad/iPhone (the native BarcodeDetector API
// is not available on Safari). Rear camera via facingMode:'environment'. Loaded
// dynamically (ssr:false) so the bundle/browser APIs never run on the server.
//
// Zoom: the camera's optical zoom (getUserMedia track) is capped well below the
// native Camera app, so we layer DIGITAL zoom on top — we crop the centre of the
// frame and decode just that crop, and CSS-scale the video so the view matches.
// Effective zoom = hardware zoom (to its max) x digital crop, so a small QR can be
// filled from a distance and the decoder sees it magnified.

// Pallet code = Crockford base32 (no I/L/O/U) with an OPTIONAL reprint suffix
// (33R5 -> 33R5-02). The suffix alternative is tried FIRST and only wins when
// the digits end the run (lookahead), so a part-number scan like CURB-36PK
// still extracts the same base token it always did. Without the suffix branch
// the scanner silently dropped "-02" and the ship flow rejected every
// reprinted label as "old/replaced" (Simon 2026-07-08 — floor had to hand-type
// every reprinted pallet on SO-00044).
const PALLET_CODE =
  /[0-9A-HJKMNP-TV-Z]{3,12}-\d{2,3}(?![0-9A-Z])|[0-9A-HJKMNP-TV-Z]{3,12}/
const DIGITAL_MAX = 4 // digital zoom multiplier allowed on top of the hardware zoom
const MAX_CANVAS = 1000 // decode the crop near its native resolution (avoid upscale blur)

function extractPalletCode(raw: string): string {
  const tail = raw.includes(',') ? raw.slice(raw.lastIndexOf(',') + 1) : raw
  const m = tail.toUpperCase().match(PALLET_CODE)
  return m ? m[0] : tail.trim().toUpperCase()
}

// Sniper-scope reticle overlay (pointer-events-none). Cosmetic only.
function Reticle() {
  const ticks = [14, 26, 38, 50, 62, 74]
  const major = (i: number) => (i % 2 === 1 ? 7 : 4)
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
        <line x1="100" y1="8" x2="100" y2="92" />
        <line x1="100" y1="108" x2="100" y2="192" />
        <line x1="8" y1="100" x2="92" y2="100" />
        <line x1="108" y1="100" x2="192" y2="100" />
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const digitalRef = useRef(1) // digital zoom factor used by the decode crop
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [hwMax, setHwMax] = useState(1) // hardware zoom max (1 = none)
  const [zoom, setZoom] = useState(1) // unified zoom (hardware x digital)

  // Hardware zoom (OS-handled, stays sharp) to its full max, then up to DIGITAL_MAX
  // more via centre-crop. So the high end roughly matches the native Camera range.
  const sliderMax = Math.max(6, Math.round(hwMax * DIGITAL_MAX))

  const applyZoom = (value: number) => {
    const z = Math.min(sliderMax, Math.max(1, value))
    setZoom(z)
    const hw = Math.min(z, hwMax)
    const digital = z / hw
    digitalRef.current = digital
    if (videoRef.current) videoRef.current.style.transform = `scale(${digital})`
    const track = trackRef.current
    if (track && hwMax > 1) {
      // `zoom` isn't in the standard MediaTrackConstraints type yet.
      track.applyConstraints({ advanced: [{ zoom: hw }] } as unknown as MediaTrackConstraints).catch(() => {})
    }
  }

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let stream: MediaStream | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reader: any = null

    const cleanup = () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
    }

    ;(async () => {
      try {
        const [{ BrowserQRCodeReader }, zxlib] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        // TRY_HARDER makes ZXing work much harder per frame — worth it for a
        // small/blurry QR (we only decode the centre crop, so cost is bounded).
        const hints = new Map()
        hints.set(zxlib.DecodeHintType.TRY_HARDER, true)
        reader = new BrowserQRCodeReader(hints)
        // Request a high-res feed so digital zoom (centre crop) keeps real detail.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        setStarting(false)

        const track = stream.getVideoTracks()[0] ?? null
        trackRef.current = track
        // Keep the camera continuously focused (default can lock focus).
        track
          ?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints)
          .catch(() => {})
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { max?: number; min?: number } }) | undefined
        if (caps?.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > 1) {
          setHwMax(caps.zoom.max)
        }

        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!

        // Decode loop: crop the centre by the digital-zoom factor and decode it at
        // (close to) native resolution — no upscaling, which would just blur it.
        const tick = () => {
          if (stopped) return
          const v = videoRef.current
          if (v && v.videoWidth && v.readyState >= 2) {
            const side = Math.min(v.videoWidth, v.videoHeight) / digitalRef.current
            const sx = (v.videoWidth - side) / 2
            const sy = (v.videoHeight - side) / 2
            const size = Math.min(Math.round(side), MAX_CANVAS)
            canvas.width = size
            canvas.height = size
            ctx.drawImage(v, sx, sy, side, side, 0, 0, size, size)
            try {
              const res = reader.decodeFromCanvas(canvas)
              if (res && !stopped) {
                cleanup()
                onResult(extractPalletCode(res.getText()))
                return
              }
            } catch {
              /* no code in this frame */
            }
          }
          timer = setTimeout(tick, 150)
        }
        tick()
      } catch (e) {
        const name = (e as Error)?.name
        setError(
          name === 'NotAllowedError'
            ? t('inventoryOps.scanDenied')
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? t('inventoryOps.scanNoCamera')
              : t('inventoryOps.scanError')
        )
        setStarting(false)
      }
    })()

    return cleanup
  }, [onResult, t])

  // Pinch-to-zoom across the full (hardware + digital) range.
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 2) return
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    pinchRef.current = { dist: Math.hypot(dx, dy), zoom }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!pinchRef.current || e.touches.length !== 2) return
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    applyZoom(pinchRef.current.zoom * (Math.hypot(dx, dy) / pinchRef.current.dist))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm font-medium">{t('inventoryOps.scanTitle')}</span>
        <button onClick={onClose} aria-label={t('inventoryOps.cancel')} className="rounded-full p-2 hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        <video ref={videoRef} className="h-full w-full origin-center object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        {!error && <Reticle />}
        {starting && !error && (
          <div className="absolute flex items-center gap-2 text-sm text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('inventoryOps.scanStarting')}
          </div>
        )}
        {!error && !starting && (
          <div className="absolute bottom-2 right-3 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
            {zoom.toFixed(1)}x
          </div>
        )}
        {error && (
          <div className="mx-6 flex max-w-sm items-center gap-2 rounded-lg bg-white p-4 text-sm text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Zoom control (hardware + digital). */}
      {!error && (
        <div className="flex items-center gap-3 px-6 pt-2 text-white">
          <button
            onClick={() => applyZoom(zoom - 0.5)}
            aria-label={t('inventoryOps.zoomOut')}
            className="rounded-full bg-white/15 p-2 active:bg-white/30"
          >
            <Minus className="h-5 w-5" />
          </button>
          <input
            type="range"
            min={1}
            max={sliderMax}
            step={0.1}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-2 flex-1 accent-white"
            aria-label={t('inventoryOps.zoom')}
          />
          <button
            onClick={() => applyZoom(zoom + 0.5)}
            aria-label={t('inventoryOps.zoomIn')}
            className="rounded-full bg-white/15 p-2 active:bg-white/30"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}

      {!error && (
        <p className="p-4 text-center text-sm text-white/80">
          {t('inventoryOps.scanHint')} {t('inventoryOps.zoomHint')}
        </p>
      )}
    </div>
  )
}
