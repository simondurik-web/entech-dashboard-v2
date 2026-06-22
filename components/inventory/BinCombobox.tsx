'use client'

import { useEffect, useRef, useState } from 'react'

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

  const filterActive = text.trim() !== '' && text !== value
  let options = (filterActive
    ? warehouses.filter((w) => w.toLowerCase().includes(text.toLowerCase()))
    : warehouses
  ).slice(0, 50)
  // Keep the committed bin visible even if it falls past the 50-row cap (show-all case).
  if (!filterActive && value && warehouses.includes(value) && !options.includes(value)) {
    options = [value, ...options].slice(0, 50)
  }

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
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
      />
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
