'use client'

import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import { useI18n } from '@/lib/i18n'
import { PhilChat } from '@/components/chat/PhilChat'
import { Bot } from 'lucide-react'

export default function PhilAssistantPage() {
  const { user, loading } = useAuth()
  const { canAccess } = usePermissions()
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/60">
        {t('phil.thinking')}
      </div>
    )
  }

  if (!user || !canAccess('/phil-assistant')) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border border-white/10 bg-white/5 p-6 text-center">
          <Bot className="mx-auto size-8 text-white/40" />
          <p className="mt-3 text-sm text-white/70">{t('phil.error.unauthorized')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <header className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-white/70" />
          <h1 className="text-lg font-semibold text-white">{t('phil.title')}</h1>
        </div>
        <p className="mt-1 text-xs text-white/50">{t('phil.subtitle')}</p>
      </header>
      <PhilChat userId={user.id} />
    </div>
  )
}
