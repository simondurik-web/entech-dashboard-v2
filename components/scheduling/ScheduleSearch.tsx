'use client'

import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { Search } from 'lucide-react'

interface ScheduleSearchProps {
  value: string
  onChange: (value: string) => void
}

export function ScheduleSearch({ value, onChange }: ScheduleSearchProps) {
  const { t } = useI18n()

  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
      <Input
        placeholder={t('scheduling.search')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
      />
    </div>
  )
}
