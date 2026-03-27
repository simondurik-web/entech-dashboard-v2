'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Lightbox } from '@/components/ui/Lightbox'
import { cn } from '@/lib/utils'

type PhotoGroup = {
  key: string
  title: string
  photos: string[]
}

interface PhotoGalleryProps {
  groups: PhotoGroup[]
  ifNumber: string
  emptyLabel?: string
  buttonLabelPrefix?: string
}

function isSupabasePhoto(url: string): boolean {
  return url.includes('supabase.co/storage')
}

export function PhotoGallery({
  groups,
  ifNumber,
  emptyLabel = 'No photos',
  buttonLabelPrefix = 'Photo',
}: PhotoGalleryProps) {
  const [lightboxPhotos, setLightboxPhotos] = useState<string[] | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const nonEmptyGroups = groups.filter((group) => group.photos.length > 0)

  if (nonEmptyGroups.length === 0) {
    return <p className="text-xs italic text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <>
      <div className="space-y-3">
        {nonEmptyGroups.map((group) => (
          <div key={group.key} className="space-y-2">
            <div className="text-sm font-semibold text-[#2a5298] dark:text-blue-300">{group.title}</div>
            <div className="flex flex-wrap gap-2">
              {group.photos.map((photo, index) => {
                if (isSupabasePhoto(photo)) {
                  return (
                    <button
                      key={`${group.key}-${photo}-${index}`}
                      type="button"
                      onClick={() => {
                        setLightboxPhotos(group.photos)
                        setLightboxIndex(index)
                      }}
                      className="overflow-hidden rounded-lg border border-border bg-muted/40 transition hover:border-primary hover:shadow-sm"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt={`${group.title} ${index + 1}`}
                        className="h-16 w-16 object-cover"
                        loading="lazy"
                      />
                    </button>
                  )
                }

                return (
                  <a
                    key={`${group.key}-${photo}-${index}`}
                    href={photo}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs font-medium transition',
                      'bg-white text-[#2a5298] hover:bg-[#f3f7ff] dark:bg-slate-950 dark:text-blue-200 dark:hover:bg-slate-900'
                    )}
                  >
                    <span>{buttonLabelPrefix} {index + 1}</span>
                    <ExternalLink className="size-3" />
                  </a>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {lightboxPhotos && (
        <Lightbox
          images={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxPhotos(null)}
          context={{ ifNumber, photoType: 'shipping-overview' }}
        />
      )}
    </>
  )
}
