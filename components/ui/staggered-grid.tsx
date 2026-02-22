"use client"

import { type ReactNode, Children } from "react"

interface StaggeredGridProps {
  children: ReactNode
  className?: string
  /** Delay between each child animation in ms */
  stagger?: number
  /** Base duration for each child in ms */
  duration?: number
}

/**
 * Wraps children in a grid where each child fades/slides in with a stagger delay.
 * Uses CSS animations — no JS animation loop.
 */
export function StaggeredGrid({ children, className = "", stagger = 80, duration = 400 }: StaggeredGridProps) {
  const items = Children.toArray(children)

  return (
    <div className={className}>
      {items.map((child, i) => (
        <div
          key={i}
          style={{
            opacity: 0,
            animation: `stagger-fade-in ${duration}ms ease-out ${i * stagger}ms forwards`,
          }}
        >
          {child}
        </div>
      ))}
      <style jsx global>{`
        @keyframes stagger-fade-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="stagger-fade-in"] {
            animation: none !important;
            opacity: 1 !important;
          }
        }
      `}</style>
    </div>
  )
}
