'use client'

import { useCallback, useEffect, useState } from 'react'
import { onToast, type ToastEvent } from '@/lib/use-toast'
import { Toast } from './toast'

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastEvent[]>([])

  useEffect(() => {
    return onToast((event) => {
      setToasts((prev) => [...prev, event])
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  )
}
