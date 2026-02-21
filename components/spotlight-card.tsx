"use client"

import { useRef, useState, type ReactNode } from "react"

interface SpotlightCardProps {
  children: ReactNode
  className?: string
  spotlightColor?: string // e.g. "59,130,246" (RGB)
  style?: React.CSSProperties
}

export function SpotlightCard({ children, className = "", spotlightColor = "255,255,255", style }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative overflow-hidden ${className}`}
      style={style}
    >
      {isHovered && (
        <div
          className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(250px circle at ${pos.x}px ${pos.y}px, rgba(${spotlightColor}, 0.12), transparent 80%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  )
}
