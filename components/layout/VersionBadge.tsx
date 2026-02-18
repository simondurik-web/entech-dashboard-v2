'use client'

import { useState } from 'react'

export function VersionBadge() {
  const [expanded, setExpanded] = useState(false)
  const hash = process.env.NEXT_PUBLIC_GIT_HASH ?? '???'
  const dateRaw = process.env.NEXT_PUBLIC_GIT_DATE ?? ''

  // Format: "2026-02-18 12:45:00 -0500" → "Feb 18, 12:45 PM"
  const formatted = dateRaw
    ? new Date(dateRaw).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="fixed bottom-20 left-2 md:bottom-2 z-40 px-2 py-0.5 rounded-md bg-muted/60 backdrop-blur text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground transition-all font-mono"
      title={`Build: ${hash} — ${dateRaw}`}
    >
      {expanded ? `v${hash} · ${formatted}` : `v${hash}`}
    </button>
  )
}
