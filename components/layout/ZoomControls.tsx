"use client"

import { useEffect, useState } from "react"
import { Minus, Plus, RotateCcw } from "lucide-react"

const STORAGE_KEY = "dashboard-zoom"
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.0
const STEP = 0.1

function getStoredZoom(): number {
  if (typeof window === "undefined") return DEFAULT_ZOOM
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return DEFAULT_ZOOM
  const val = parseFloat(stored)
  return isNaN(val) ? DEFAULT_ZOOM : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, val))
}

function dispatchZoom(zoom: number) {
  localStorage.setItem(STORAGE_KEY, String(zoom))
  window.dispatchEvent(new CustomEvent("zoom-changed", { detail: { zoom } }))
}

export function ZoomControls() {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  useEffect(() => {
    setZoom(getStoredZoom())
  }, [])

  const update = (next: number) => {
    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 10) / 10
    setZoom(clamped)
    dispatchZoom(clamped)
  }

  return (
    <div className="hidden items-center gap-1.5 border-t border-white/10 px-4 py-2 lg:flex">
      <span className="mr-auto text-[10px] font-semibold uppercase tracking-widest text-white/50">
        Zoom
      </span>
      <button
        onClick={() => update(zoom - STEP)}
        disabled={zoom <= MIN_ZOOM}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
        aria-label="Zoom out"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-[3ch] text-center text-xs tabular-nums text-white/90">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => update(zoom + STEP)}
        disabled={zoom >= MAX_ZOOM}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
        aria-label="Zoom in"
      >
        <Plus className="size-3.5" />
      </button>
      <button
        onClick={() => update(DEFAULT_ZOOM)}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="Reset zoom"
      >
        <RotateCcw className="size-3" />
      </button>
    </div>
  )
}
