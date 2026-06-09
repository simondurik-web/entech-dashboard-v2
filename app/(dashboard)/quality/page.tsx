"use client"

import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { ClipboardCheck, CircleDot, Disc, PackageCheck, AlertTriangle } from "lucide-react"
import Link from "next/link"

// Phase 1 placeholder landing page for the integrated Quality (EODR) section.
// Renders inside the molding shell (sidebar + header), so "back to the molding
// dashboard" is just clicking any other sidebar item. The real dashboard
// (counts + recent inspections) is ported in Phase 2.
export default function QualityHomePage() {
  const { t } = useI18n()
  const { qualityRole } = useQualityAccess()

  const tiles = [
    { href: "/quality/hubs", icon: <CircleDot className="size-5" />, label: t("nav.qualityHubs") },
    { href: "/quality/tires", icon: <Disc className="size-5" />, label: t("nav.qualityTires") },
    { href: "/quality/finished", icon: <PackageCheck className="size-5" />, label: t("nav.qualityFinished") },
    { href: "/quality/ncr", icon: <AlertTriangle className="size-5" />, label: t("nav.qualityNcr") },
  ]

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
          <ClipboardCheck className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">{t("quality.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("quality.subtitle")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-blue-500/40 hover:bg-accent"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              {tile.icon}
            </span>
            <span className="text-sm font-medium">{tile.label}</span>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        {t("quality.placeholder")}
        {qualityRole ? ` · ${qualityRole}` : ""}
      </p>
    </div>
  )
}
