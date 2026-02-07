'use client'

import { useI18n } from '@/lib/i18n'
import { Languages } from 'lucide-react'

export function LanguageToggle() {
  const { language, setLanguage } = useI18n()

  return (
    <div className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs">
      <Languages className="size-3.5" />
      <button
        onClick={() => setLanguage('en')}
        className={`px-1.5 py-0.5 rounded transition-colors ${
          language === 'en'
            ? 'bg-white/20 font-medium text-white'
            : 'text-white/50 hover:text-white'
        }`}
      >
        EN
      </button>
      <span className="text-white/30">/</span>
      <button
        onClick={() => setLanguage('es')}
        className={`px-1.5 py-0.5 rounded transition-colors ${
          language === 'es'
            ? 'bg-white/20 font-medium text-white'
            : 'text-white/50 hover:text-white'
        }`}
      >
        ES
      </button>
    </div>
  )
}
