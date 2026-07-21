'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Loader2, Truck } from 'lucide-react'
import { CARRIERS } from '@/lib/carriers'
import { useI18n } from '@/lib/i18n'
import { authHeaders } from '@/lib/session-token'

const OTHER = '__other__'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : iso
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Planned carrier + scheduled ship date for a Sales Order. Lives in the BOL
 * section (the shipping manager's surface — Simon 2026-07-21). Self-fetches
 * current values so hosts don't need to thread order fields through. Writes
 * fan out server-side to all lines of the SO and, when the order rides an
 * active truckload, to every member SO.
 */
export function ShipmentScheduleEditor({ soName, canManage }: { soName: string; canManage: boolean }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  // A failed initial read leaves the form blank — saving then would silently
  // CLEAR a schedule someone else set. No read, no write.
  const [loadFailed, setLoadFailed] = useState(false)
  const [carrierSel, setCarrierSel] = useState('')
  const [carrierCustom, setCarrierCustom] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [setBy, setSetBy] = useState<string | null>(null)
  const [tlSos, setTlSos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/orders/schedule?so=${encodeURIComponent(soName)}`, {
          headers: authHeaders(),
          cache: 'no-store',
        })
        if (!res.ok) {
          // 404 = no dashboard rows for this SO. Save stays enabled — a POST
          // would 404 the same way (clean error, nothing to clobber).
          if (active && res.status !== 404) setLoadFailed(true)
          return
        }
        const body = await res.json()
        if (!active) return
        const carrier = String(body.carrier ?? '')
        if (carrier && (CARRIERS as readonly string[]).includes(carrier)) {
          setCarrierSel(carrier)
        } else if (carrier) {
          setCarrierSel(OTHER)
          setCarrierCustom(carrier)
        }
        setDateStr(String(body.scheduledShipDate ?? ''))
        setSetBy(body.setBy ?? null)
        setTlSos(Array.isArray(body.truckloadSos) ? body.truckloadSos : [])
      } catch {
        if (active) setLoadFailed(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [soName])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSavedMsg(null)
    try {
      const carrier = carrierSel === OTHER ? carrierCustom.trim() : carrierSel
      const res = await fetch('/api/orders/schedule', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ so: soName, carrier, scheduledShipDate: dateStr }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t('schedule.saveError'))
      const sos: string[] = body?.sos ?? [soName]
      setSavedMsg(
        sos.length > 1
          ? t('schedule.savedTruckload').replace('{sos}', sos.join(', '))
          : t('schedule.saved')
      )
      setTimeout(() => setSavedMsg(null), 6000)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('schedule.saveError'))
    } finally {
      setSaving(false)
    }
  }, [soName, carrierSel, carrierCustom, dateStr, t])

  const overdue = !!dateStr && dateStr < todayIso()
  const carrierShown = carrierSel === OTHER ? carrierCustom : carrierSel

  return (
    <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5" style={{ borderTopWidth: 2, borderTopColor: 'rgb(14, 165, 233)' }}>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-500">
        <CalendarClock className="size-3.5" /> {t('schedule.title')}
        {tlSos.length > 0 && (
          <span
            title={t('schedule.tlHint').replace('{sos}', tlSos.join(', '))}
            className="ml-auto rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-600"
          >
            🚛 {t('schedule.tlBadge').replace('{count}', String(tlSos.length + 1))}
          </span>
        )}
      </h4>

      {loading ? (
        <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> {t('ui.loading')}
        </div>
      ) : canManage ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={carrierSel}
              onChange={(e) => setCarrierSel(e.target.value)}
              className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-xs"
              aria-label={t('schedule.carrier')}
            >
              <option value="">{t('schedule.noCarrier')}</option>
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={OTHER}>{t('schedule.otherCarrier')}</option>
            </select>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-xs"
              aria-label={t('schedule.date')}
            />
          </div>
          {carrierSel === OTHER && (
            <input
              type="text"
              value={carrierCustom}
              onChange={(e) => setCarrierCustom(e.target.value)}
              placeholder={t('schedule.otherPlaceholder')}
              maxLength={60}
              className="w-full rounded border bg-background px-2 py-1 text-xs"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loadFailed}
              title={loadFailed ? t('schedule.loadFailed') : undefined}
              className="inline-flex items-center gap-1 rounded bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : <Truck className="size-3" />}
              {t('schedule.save')}
            </button>
            {overdue && (
              <span className="text-[10px] font-semibold text-red-500">{t('schedule.pastDate')}</span>
            )}
            {setBy && !savedMsg && (
              <span className="ml-auto truncate text-[10px] text-muted-foreground">
                {t('schedule.setBy')} {setBy}
              </span>
            )}
          </div>
          {savedMsg && <p className="text-[10px] font-medium text-emerald-600">{savedMsg}</p>}
          {error && <p className="text-[10px] text-red-500">{error}</p>}
        </div>
      ) : (
        <p className="text-[11px]">
          {carrierShown || dateStr ? (
            <>
              {carrierShown && <span className="font-semibold">{carrierShown}</span>}
              {carrierShown && dateStr && ' · '}
              {dateStr && <span className={overdue ? 'font-semibold text-red-500' : ''}>{fmtDate(dateStr)}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">{t('schedule.none')}</span>
          )}
        </p>
      )}
    </div>
  )
}
