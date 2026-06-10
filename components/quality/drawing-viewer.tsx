"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { ChevronLeft, ChevronRight, FileImage, Loader2, Printer, X, ZoomIn } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { userHeaders } from "@/lib/quality/form-utils"

const PdfCanvas = dynamic(() => import("@/components/ui/PdfCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex size-20 items-center justify-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  ),
})

interface DrawingViewerProps {
  partNumbers: string[]
  labels?: string[]
}

interface DrawingFile {
  url: string
  name: string
  type: "image" | "pdf"
  partNumber: string
  label: string
}

function printImage(url: string, title: string) {
  const w = window.open("", "_blank", "width=900,height=1100")
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      html,body{margin:0;padding:0;background:#fff;}
      img{display:block;max-width:100%;max-height:100vh;margin:0 auto;}
      @media print{@page{margin:8mm;}img{max-height:none;width:100%;}}
    </style></head><body>
    <img src="${url}" onload="setTimeout(()=>{window.focus();window.print();},150)" />
    </body></html>`)
  w.document.close()
}

function PdfThumb({ url }: { url: string }) {
  return (
    <div className="size-20 overflow-hidden bg-background">
      <PdfCanvas url={url} page={1} width={80} onLoadSuccess={() => undefined} onError={() => undefined} />
    </div>
  )
}

export function DrawingViewer({ partNumbers, labels }: DrawingViewerProps) {
  const { profile } = useAuth()
  const { t } = useI18n()
  const [drawings, setDrawings] = useState<DrawingFile[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const requestedParts = useMemo(() => {
    const seen = new Set<string>()
    return partNumbers
      .map((partNumber, i) => ({ partNumber, label: labels?.[i] || partNumber }))
      .filter(({ partNumber }) => {
        if (!partNumber || seen.has(partNumber)) return false
        seen.add(partNumber)
        return true
      })
  }, [partNumbers, labels])

  useEffect(() => {
    let cancelled = false
    async function fetchDrawings() {
      const all: DrawingFile[] = []
      for (const part of requestedParts) {
        try {
          const res = await fetch(`/api/quality/drawings?part=${encodeURIComponent(part.partNumber)}`, {
            headers: userHeaders(profile?.id),
          })
          if (!res.ok) continue
          const data = await res.json()
          const files: Array<{ url: string; name: string; type: "image" | "pdf" }> =
            data.files ?? (data.urls ?? []).map((url: string) => ({ url, name: "", type: "image" as const }))
          files.forEach((file) => all.push({ ...file, partNumber: part.partNumber, label: part.label }))
        } catch {
          // A missing drawing should not block the inspection workflow.
        }
      }
      if (!cancelled) {
        setDrawings(all)
        setLoading(false)
      }
    }

    setLoading(true)
    if (requestedParts.length > 0) void fetchDrawings()
    else {
      setDrawings([])
      setLoading(false)
    }
    return () => { cancelled = true }
  }, [requestedParts, profile?.id])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <FileImage className="size-4 animate-pulse" />
        <span>{t("quality.drawings.loading")}</span>
      </div>
    )
  }
  if (drawings.length === 0) return null

  const grouped = requestedParts
    .map((part) => ({ ...part, files: drawings.filter((drawing) => drawing.partNumber === part.partNumber) }))
    .filter((group) => group.files.length > 0)

  const expanded = expandedIdx != null ? drawings[expandedIdx] : null
  const closeExpanded = () => setExpandedIdx(null)
  const stepExpanded = (delta: number) => {
    if (expandedIdx == null) return
    setExpandedIdx((expandedIdx + delta + drawings.length) % drawings.length)
  }

  return (
    <>
      <div className="space-y-2 rounded-md border bg-card p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-blue-600 dark:text-blue-400">
          <FileImage className="size-3" />
          {t("quality.drawings.title")}
        </p>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {grouped.map((group) => (
            <div key={group.partNumber} className="shrink-0">
              <p className="mb-1 max-w-32 truncate text-[10px] text-muted-foreground">{group.label}</p>
              <div className="flex gap-2">
                {group.files.map((drawing) => {
                  const idx = drawings.indexOf(drawing)
                  return (
                    <button
                      type="button"
                      key={drawing.url}
                      onClick={() => setExpandedIdx(idx)}
                      className="group relative size-20 overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-blue-500/40"
                      title={drawing.name || (drawing.type === "pdf" ? "PDF" : t("quality.drawings.title"))}
                    >
                      {drawing.type === "image" ? (
                        <img src={drawing.url} alt={`${group.label} drawing`} className="size-full object-cover" loading="lazy" />
                      ) : (
                        <PdfThumb url={drawing.url} />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                        <ZoomIn className="size-4 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2 backdrop-blur-sm" onClick={closeExpanded}>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                if (expanded.type === "pdf") window.open(expanded.url, "_blank", "noopener,noreferrer")
                else printImage(expanded.url, expanded.label)
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              title={t("quality.drawings.print")}
            >
              <Printer className="size-4" />
              <span>{t("quality.drawings.print")}</span>
            </button>
            <button type="button" className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" onClick={closeExpanded}>
              <X className="size-7" />
            </button>
          </div>

          {drawings.length > 1 && (
            <>
              <button
                type="button"
                className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/70 hover:text-white sm:left-4"
                onClick={(e) => { e.stopPropagation(); stepExpanded(-1) }}
              >
                <ChevronLeft className="size-8" />
              </button>
              <button
                type="button"
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/70 hover:text-white sm:right-4"
                onClick={(e) => { e.stopPropagation(); stepExpanded(1) }}
              >
                <ChevronRight className="size-8" />
              </button>
            </>
          )}

          {expanded.type === "image" ? (
            <img
              src={expanded.url}
              alt={expanded.label}
              className="max-h-[88vh] max-w-[92vw] rounded-md object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="h-[88vh] w-[94vw] overflow-hidden rounded-md bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <iframe src={expanded.url} title={expanded.label} className="size-full" />
            </div>
          )}

          <p className="absolute bottom-4 max-w-[90vw] truncate text-sm text-white/60">
            {expanded.label} - {expanded.type === "pdf" ? "PDF" : t("quality.drawings.one")} {(expandedIdx ?? 0) + 1}/{drawings.length}
          </p>
        </div>
      )}
    </>
  )
}
