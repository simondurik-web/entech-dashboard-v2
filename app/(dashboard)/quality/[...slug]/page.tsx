"use client"

import { useI18n } from "@/lib/i18n"
import { Construction } from "lucide-react"
import Link from "next/link"

// Catch-all placeholder for Quality sub-routes that haven't been ported yet
// (Phase 2). A more specific route file (e.g. quality/hubs/page.tsx) takes
// precedence over this catch-all, so each ported screen automatically replaces
// the placeholder. Until then, QA users see a friendly "coming soon" inside the
// molding shell instead of a raw 404. Access is already gated by AccessGuard.
export default function QualityComingSoonPage() {
  const { t } = useI18n()
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
        <Construction className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">{t("quality.comingSoon")}</h1>
      <Link
        href="/quality"
        className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
      >
        {t("quality.comingSoonBack")}
      </Link>
    </div>
  )
}
