'use client'

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import en from '@/locales/en.json'
import es from '@/locales/es.json'

export type Language = 'en' | 'es'

const translations: Record<Language, Record<string, string>> = { en, es }

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  /** Translate a key. Falls back to English, then to the key itself. */
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en')

  useEffect(() => {
    const stored = localStorage.getItem('language') as Language | null
    if (stored && (stored === 'en' || stored === 'es')) {
      setLanguageState(stored)
    }
  }, [])

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('language', lang)
  }, [])

  const t = useCallback(
    (key: string): string => {
      return translations[language]?.[key] ?? translations.en?.[key] ?? key
    },
    [language]
  )

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}

export function useTranslation() {
  return useI18n()
}
