'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

// A single bin/warehouse combobox: shows the committed `value`, click to reveal all bins,
// type to filter, pick to commit. Focus selects-all so typing replaces (no manual delete);
// blur reverts unconfirmed text to the committed value; option buttons preventDefault on
// mousedown so a pick never blurs the input (no stale-revert desync). The list opts out of
// Lenis smooth-scroll via data-lenis-prevent so it scrolls on hover.
export function BinCombobox({
  value,
  onChange,
  warehouses,
  placeholder,
  noBinsLabel,
}: {
  value: string
  onChange: (bin: string) => void
  warehouses: string[]
  placeholder?: string
  noBinsLabel: string
}) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reflect external commits (default loaded, parent reset) in the box.
  useEffect(() => {
    setText(value)
  }, [value])

  // Show ALL bins (the dropdown is scrollable) — when browsing without typing, the
  // operator needs to see every available bin, matching the By-bin search. Filtering
  // narrows the same full list.
  const filterActive = text.trim() !== '' && text !== value
  const options = filterActive
    ? warehouses.filter((w) => w.toLowerCase().includes(text.toLowerCase()))
    : warehouses

  return (
    <div className="relative">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={(e) => {
          if (blurTimer.current) clearTimeout(blurTimer.current)
          setOpen(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setOpen(false)
            setText(value)
          }, 150)
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background pl-3 pr-9 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
      />
      {(text || value) && (
        // Clear the selection AND the typed text (mousedown-preventDefault so the
        // input's blur-revert doesn't restore the old value first).
        <button
          type="button"
          aria-label="clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (blurTimer.current) clearTimeout(blurTimer.current); onChange(''); setText(''); setOpen(false) }}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div data-lenis-prevent className="inv-scroll max-h-60 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
            {options.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">{noBinsLabel}</div>
            ) : (
              options.map((w) => (
                <button
                  type="button"
                  key={w}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(w)
                    setText(w)
                    setOpen(false)
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent ${value === w ? 'bg-primary/15 font-medium text-primary' : ''}`}
                >
                  {w}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
