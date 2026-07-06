// ERPNext stores naive datetimes and renders them in the site's timezone
// (America/Detroit). The dashboard runs on Vercel in UTC, so writing
// `new Date().toISOString()` into a custom datetime field lands 4-5h ahead of
// the real shop-floor time (Simon 2026-07-06: DN "shipped at" read 4h late).
// Format "now" as a naive YYYY-MM-DD HH:MM:SS string in the ERP's timezone.

const ERP_TZ = 'America/Detroit'

/** Current time as an ERPNext-naive local timestamp: "YYYY-MM-DD HH:MM:SS"
 *  in America/Detroit, regardless of the server's own timezone. */
export function erpNow(date: Date = new Date()): string {
  // en-CA gives ISO-ish "YYYY-MM-DD"; hour12:false keeps 00-23. Intl applies
  // the tz offset (incl. DST) for us.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ERP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  // hour can come back as '24' at midnight in some engines — normalize.
  const hour = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')} ${hour}:${g('minute')}:${g('second')}`
}
