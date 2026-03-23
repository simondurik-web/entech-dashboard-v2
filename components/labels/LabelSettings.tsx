'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { Save, Check } from 'lucide-react'

export function LabelSettings() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/labels/settings')
      .then(r => r.json())
      .then(setSettings)
      .finally(() => setLoading(false))
  }, [])

  const updateSetting = async (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const saveSettings = async () => {
    if (!user) return
    setSaving(true)

    for (const [key, value] of Object.entries(settings)) {
      await fetch('/api/labels/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({ setting_key: key, setting_value: value }),
      })
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <label className="text-sm font-medium">{t('labels.emailRecipients')}</label>
        <p className="text-xs text-muted-foreground mb-2">Comma-separated email addresses</p>
        <Input
          value={settings.email_recipients || ''}
          onChange={(e) => updateSetting('email_recipients', e.target.value)}
          placeholder="user@example.com, user2@example.com"
        />
      </div>

      <div className="flex items-center gap-3">
        <Checkbox
          checked={settings.auto_enabled === 'true'}
          onCheckedChange={(checked) => updateSetting('auto_enabled', checked ? 'true' : 'false')}
        />
        <div>
          <label className="text-sm font-medium">{t('labels.autoGeneration')}</label>
          <p className="text-xs text-muted-foreground">
            {settings.auto_enabled === 'true' ? t('labels.enabled') : t('labels.disabled')}
          </p>
        </div>
      </div>

      <Button onClick={saveSettings} disabled={saving}>
        {saved ? (
          <>
            <Check className="size-4 mr-1" />
            {t('ui.saved')}
          </>
        ) : (
          <>
            <Save className="size-4 mr-1" />
            {saving ? t('ui.saving') : t('ui.saveChanges')}
          </>
        )}
      </Button>
    </div>
  )
}
