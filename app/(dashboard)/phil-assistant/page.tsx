'use client'

import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import { useI18n } from '@/lib/i18n'
import { PhilChat } from '@/components/chat/PhilChat'
import { Bot } from 'lucide-react'

export default function PhilAssistantPage() {
  const { user, profile, loading } = useAuth()
  const { canAccess } = usePermissions()
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('phil.thinking')}
      </div>
    )
  }

  // profile (not user): approved floor devices (e.g. the Tesla browser paired
  // as manager) run on a device pseudo-profile with NO Supabase user — gating
  // on user denied them even though their role has access (Simon 2026-07-11)
  if (!profile || !canAccess('/phil-assistant')) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border bg-card p-6 text-center">
          <Bot className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">{t('phil.error.unauthorized')}</p>
        </div>
      </div>
    )
  }

  // Use dvh so the on-screen keyboard doesn't cover the input on mobile.
  // The dashboard layout has chrome above us; the flex column fills what's left.
  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-1 flex-col lg:min-h-[calc(100vh-4rem)]">
      <header className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">{t('phil.title')}</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('phil.subtitle')}</p>
      </header>
      <PhilChat userId={user?.id ?? profile.id} />
    </div>
  )
}
