'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Lightbox } from '@/components/ui/Lightbox'
import type { ShippingOverviewPallet } from '@/components/shipping-overview/types'

interface PalletTableProps {
  pallets: ShippingOverviewPallet[]
  ifNumber: string
}

function isSupabasePhoto(url: string): boolean {
  return url.includes('supabase.co/storage')
}

export function PalletTable({ pallets, ifNumber }: PalletTableProps) {
  const [lightboxPhotos, setLightboxPhotos] = useState<string[] | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  if (pallets.length === 0) {
    return <p className="text-xs italic text-muted-foreground">No pallet records</p>
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Pallet #</th>
              <th className="px-4 py-3 font-semibold">Weight</th>
              <th className="px-4 py-3 font-semibold">Dimensions</th>
              <th className="px-4 py-3 font-semibold">Photos</th>
            </tr>
          </thead>
          <tbody>
            {pallets.map((pallet, index) => (
              <tr
                key={`${pallet.palletNumber}-${index}`}
                className="border-t border-border odd:bg-background even:bg-muted/20"
              >
                <td className="px-4 py-3 font-semibold">#{pallet.palletNumber || index + 1}</td>
                <td className="px-4 py-3">{pallet.weightDisplay || (pallet.weight ? pallet.weight.toLocaleString() : '-')}</td>
                <td className="px-4 py-3">{pallet.dimensions || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {pallet.photos.length === 0 && (
                      <span className="text-xs italic text-muted-foreground">No photos</span>
                    )}
                    {pallet.photos.map((photo, photoIndex) => {
                      if (isSupabasePhoto(photo)) {
                        return (
                          <button
                            key={`${photo}-${photoIndex}`}
                            type="button"
                            onClick={() => {
                              setLightboxPhotos(pallet.photos)
                              setLightboxIndex(photoIndex)
                            }}
                            className="overflow-hidden rounded-md border border-border transition hover:border-primary"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo}
                              alt={`Pallet ${pallet.palletNumber} photo ${photoIndex + 1}`}
                              className="h-12 w-12 object-cover"
                              loading="lazy"
                            />
                          </button>
                        )
                      }

                      return (
                        <a
                          key={`${photo}-${photoIndex}`}
                          href={photo}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-[#2a5298] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e3c72]"
                        >
                          <span>Photo {photoIndex + 1}</span>
                          <ExternalLink className="size-3" />
                        </a>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lightboxPhotos && (
        <Lightbox
          images={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxPhotos(null)}
          context={{ ifNumber, photoType: 'pallet' }}
        />
      )}
    </>
  )
}
