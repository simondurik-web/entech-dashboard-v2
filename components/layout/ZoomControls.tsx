"use client"

import { useEffect, useState, useRef } from "react"
import { Minus, Plus, RotateCcw } from "lucide-react"

const STORAGE_KEY = "dashboard-zoom"
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.0
const STEP = 0.05

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
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setZoom(getStoredZoom())
  }, [])

  const update = (next: number) => {
    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100
    setZoom(clamped)
    dispatchZoom(clamped)
  }

  const startEditing = () => {
    setInputValue(String(Math.round(zoom * 100)))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 10)
  }

  const commitEdit = () => {
    setEditing(false)
    const val = parseFloat(inputValue)
    if (!isNaN(val) && val >= MIN_ZOOM * 100 && val <= MAX_ZOOM * 100) {
      update(val / 100)
    }
  }

  const displayPercent = Math.round(zoom * 100)

  return (
    <div className="hidden items-center gap-1 border-t border-white/10 px-3 py-2 lg:flex">
      <span className="mr-auto text-[10px] font-semibold uppercase tracking-widest text-white/50 shrink-0">
        Zoom
      </span>
      <button
        onClick={() => update(zoom - STEP)}
        disabled={zoom <= MIN_ZOOM}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 shrink-0"
        aria-label="Zoom out"
      >
        <Minus className="size-3.5" />
      </button>

      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min={MIN_ZOOM * 100}
          max={MAX_ZOOM * 100}
          step={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit()
            if (e.key === "Escape") setEditing(false)
          }}
          className="w-12 rounded bg-white/20 px-1 py-0.5 text-center text-xs tabular-nums text-white outline-none focus:ring-1 focus:ring-white/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      ) : (
        <button
          onClick={startEditing}
          className="min-w-[3ch] rounded px-1 py-0.5 text-center text-xs tabular-nums text-white/90 hover:bg-white/20 hover:text-white transition-colors cursor-text"
          title="Click to type a custom zoom %"
        >
          {displayPercent}%
        </button>
      )}

      <button
        onClick={() => update(zoom + STEP)}
        disabled={zoom >= MAX_ZOOM}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 shrink-0"
        aria-label="Zoom in"
      >
        <Plus className="size-3.5" />
      </button>
      <button
        onClick={() => update(DEFAULT_ZOOM)}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white shrink-0"
        aria-label="Reset zoom"
      >
        <RotateCcw className="size-3" />
      </button>
    </div>
  )
}
