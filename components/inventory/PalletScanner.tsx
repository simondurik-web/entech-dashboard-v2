'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
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

export default function PalletScanner({
  onResult,
  onClose,
}: {
  onResult: (code: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)

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
        if (stopped) controls.stop()
        else setStarting(false)
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

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {!error && (
          // Centered reticle to aim the label QR.
          <div className="pointer-events-none absolute h-56 w-56 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        )}
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

      {!error && (
        <p className="p-4 text-center text-sm text-white/80">{t('inventoryOps.scanHint')}</p>
      )}
    </div>
  )
}
