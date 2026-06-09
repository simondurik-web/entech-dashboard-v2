"use client"

import { cn } from "@/lib/utils"
import {
  computeSpecStatus,
  findLimit,
  specStatusClass,
  type LimitsIndex,
} from "@/lib/quality/limits"

/** Base pill styling shared by all quality badges (theme-aware). */
function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  )
}

const DASH = <span className="text-muted-foreground/50">—</span>

/**
 * A measurement value colored by its spec status (green/amber/red), matching
 * the standalone EQDR app. Shows a `*` when a value exists but has no target.
 */
export function SpecValue({
  value,
  index,
  productType,
  productNumber,
  metricKey,
}: {
  value: number | null | undefined
  index: LimitsIndex
  productType: string
  productNumber: string | null | undefined
  metricKey: string
}) {
  if (value == null) return DASH
  const lim = findLimit(index, productType, productNumber, metricKey)
  const status = computeSpecStatus(value, lim)
  return (
    <span className={cn("font-medium tabular-nums", specStatusClass(status))}>
      {value.toFixed(2)}
      {status === "no_target" ? <sup className="text-muted-foreground">*</sup> : null}
    </span>
  )
}

const PASS_WORDS = new Set(["PASS", "YES", "CORRECT", "TRUE"])

/** PASS/YES/CORRECT → green, anything else → red. Mirrors EQDR's passFail(). */
export function PassFail({ value }: { value: unknown }) {
  if (!value) return DASH
  const s = String(value).toUpperCase()
  const pass = PASS_WORDS.has(s)
  if (s === "N/A" || s === "NA")
    return <Pill className="border-border bg-muted text-muted-foreground">{s}</Pill>
  return (
    <Pill
      className={
        pass
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      }
    >
      {s}
    </Pill>
  )
}

const NCR_STATUS_CLASS: Record<string, string> = {
  OPEN: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  INVESTIGATING: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  CLOSED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
}

export function NcrStatusBadge({ value }: { value: unknown }) {
  if (!value) return DASH
  const s = String(value).toUpperCase()
  return <Pill className={cn("border-border text-foreground", NCR_STATUS_CLASS[s])}>{s}</Pill>
}

const DEFECT_CLASS: Record<string, string> = {
  visual: "text-purple-600 dark:text-purple-400 border-purple-500/30",
  dimensional: "text-blue-600 dark:text-blue-400 border-blue-500/30",
  weight: "text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  bonding: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  locking_pin: "text-orange-600 dark:text-orange-400 border-orange-500/30",
  contamination: "text-red-600 dark:text-red-400 border-red-500/30",
  other: "text-muted-foreground border-border",
}

export function DefectBadge({ value }: { value: unknown }) {
  if (!value) return DASH
  const k = String(value).toLowerCase()
  return <Pill className={cn(DEFECT_CLASS[k] ?? DEFECT_CLASS.other)}>{String(value)}</Pill>
}

/** Neutral pill for product-type / disposition etc. */
export function NeutralBadge({ value }: { value: unknown }) {
  if (!value) return DASH
  return <Pill className="border-border bg-muted text-foreground">{String(value)}</Pill>
}
