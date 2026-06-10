'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense } from 'react'

function ScanHandler() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState('Loading...')

  const line = searchParams.get('line')
  const pallet = searchParams.get('pallet')
  const total = searchParams.get('total')

  useEffect(() => {
    if (!line) {
      setStatus('Invalid QR code — no line number found.')
      return
    }

    // Store scan context in sessionStorage so the main page can pick it up
    const scanData = {
      line_number: line,
      pallet_number: pallet ? parseInt(pallet) : null,
      total_pallets: total ? parseInt(total) : null,
      scanned_at: new Date().toISOString()
    }
    localStorage.setItem('scan_context', JSON.stringify(scanData))

    // Redirect to main page — it will detect scan_context and open the right order
    setStatus(`Opening order line ${line}, pallet ${pallet || '?'}...`)
    router.replace('/pallet-records')
  }, [line, pallet, total, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="text-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600 dark:border-sky-400 mx-auto mb-4"></div>
        <p className="text-lg text-muted-foreground">{status}</p>
        {line && (
          <p className="text-sm text-muted-foreground mt-2">
            Line {line} {pallet && `• Pallet ${pallet}`} {total && `of ${total}`}
          </p>
        )}
      </div>
    </div>
  )
}

export default function ScanPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600 dark:border-sky-400 mx-auto"></div>
      </div>
    }>
      <ScanHandler />
    </Suspense>
  )
}
