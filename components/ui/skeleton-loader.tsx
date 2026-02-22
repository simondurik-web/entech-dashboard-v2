"use client"

import { cn } from "@/lib/utils"

function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/50",
        className
      )}
      style={style}
    />
  )
}

/** Skeleton replacement for a stat card grid */
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-4 flex items-start gap-3 shadow-lg"
        >
          <Shimmer className="rounded-lg h-10 w-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-3 w-16" />
            <Shimmer className="h-6 w-20" />
            <Shimmer className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Skeleton replacement for a data table */
export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 p-4 border-b border-white/[0.06]">
        {Array.from({ length: cols }).map((_, i) => (
          <Shimmer key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 p-4 border-b border-white/[0.04] last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Shimmer key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Skeleton for chart containers */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-6 shadow-lg", className)}>
      <Shimmer className="h-4 w-32 mb-4" />
      <div className="flex items-end gap-2 h-48">
        {Array.from({ length: 12 }).map((_, i) => (
          <Shimmer
            key={i}
            className="flex-1 rounded-t-sm"
            style={{ height: `${30 + Math.random() * 70}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** Full page loading skeleton (stat cards + table) */
export function PageSkeleton({ statCards = 4, tableRows = 8 }: { statCards?: number; tableRows?: number }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <StatCardSkeleton count={statCards} />
      <TableSkeleton rows={tableRows} />
    </div>
  )
}
