'use client'

import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToastEvent, ToastType } from '@/lib/use-toast'

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="size-4 text-green-500" />,
  error: <AlertCircle className="size-4 text-red-500" />,
  warning: <AlertTriangle className="size-4 text-amber-500" />,
  info: <Info className="size-4 text-blue-500" />,
}

const borderColors: Record<ToastType, string> = {
  success: 'border-l-green-500',
  error: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
}

export function Toast({ toast: t, onDismiss }: { toast: ToastEvent; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true)
      setTimeout(() => onDismiss(t.id), 300)
    }, 3000)
    return () => clearTimeout(timer)
  }, [t.id, onDismiss])

  const handleDismiss = () => {
    setExiting(true)
    setTimeout(() => onDismiss(t.id), 300)
  }

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 bg-card p-3 shadow-lg',
        borderColors[t.type]
      )}
      style={{
        animation: exiting ? 'toast-slide-out 300ms ease-in forwards' : 'toast-slide-in 300ms ease-out',
      }}
    >
      <span className="mt-0.5 shrink-0">{icons[t.type]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t.title}</p>
        {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
      </div>
      <button onClick={handleDismiss} className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
