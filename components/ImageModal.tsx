"use client"

import { useEffect } from "react"

export type ImageModalProps = {
  src: string
  alt?: string
  isOpen: boolean
  onClose: () => void
}

export function ImageModal({ src, alt = "Image preview", isOpen, onClose }: ImageModalProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex animate-in fade-in items-center justify-center bg-black/80 p-4 duration-300"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Close image modal"
      >
        <span className="text-2xl leading-none">&times;</span>
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] object-contain"
      />
    </div>
  )
}

export default ImageModal
