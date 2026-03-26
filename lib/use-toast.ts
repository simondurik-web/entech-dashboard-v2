type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastEvent {
  id: string
  title: string
  description?: string
  type: ToastType
}

type ToastListener = (event: ToastEvent) => void

const listeners = new Set<ToastListener>()

export function onToast(listener: ToastListener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let counter = 0

export function toast({ title, description, type = 'info' }: Omit<ToastEvent, 'id'>) {
  const event: ToastEvent = { id: String(++counter), title, description, type }
  listeners.forEach((fn) => fn(event))
}

export type { ToastEvent, ToastType }
