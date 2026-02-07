'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Category = 'Roll Tech' | 'Molding' | 'Snap Pad'

type Drawing = {
  partNumber: string
  drawingUrl: string
  category: Category
}

const DRAWINGS: Drawing[] = [
  { partNumber: 'RT-1001', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'RT-1002', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'RT-1003', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'RT-1004', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'RT-1005', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'RT-1006', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'MD-2001', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
  { partNumber: 'MD-2002', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
  { partNumber: 'MD-2003', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
  { partNumber: 'MD-2004', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
  { partNumber: 'MD-2005', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
  { partNumber: 'MD-2006', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
  { partNumber: 'SP-3001', drawingUrl: '/placeholder-drawing.svg', category: 'Snap Pad' },
  { partNumber: 'SP-3002', drawingUrl: '/placeholder-drawing.svg', category: 'Snap Pad' },
  { partNumber: 'SP-3003', drawingUrl: '/placeholder-drawing.svg', category: 'Snap Pad' },
  { partNumber: 'SP-3004', drawingUrl: '/placeholder-drawing.svg', category: 'Snap Pad' },
  { partNumber: 'SP-3005', drawingUrl: '/placeholder-drawing.svg', category: 'Snap Pad' },
  { partNumber: 'SP-3006', drawingUrl: '/placeholder-drawing.svg', category: 'Snap Pad' },
  { partNumber: 'RT-1010', drawingUrl: '/placeholder-drawing.svg', category: 'Roll Tech' },
  { partNumber: 'MD-2010', drawingUrl: '/placeholder-drawing.svg', category: 'Molding' },
]

const FILTERS: Array<'All' | Category> = ['All', 'Roll Tech', 'Molding', 'Snap Pad']

export default function DrawingsPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'All' | Category>('All')

  const filteredDrawings = useMemo(() => {
    return DRAWINGS.filter((drawing) => {
      const matchesSearch = drawing.partNumber.toLowerCase().includes(search.toLowerCase().trim())
      const matchesCategory = category === 'All' || drawing.category === category
      return matchesSearch && matchesCategory
    })
  }, [search, category])

  return (
    <div className="p-4 pb-20 space-y-4">
      <h1 className="text-2xl font-bold">📐 Drawings Library</h1>

      <div className="text-sm text-muted-foreground">
        Total drawings: <span className="font-semibold text-foreground">{DRAWINGS.length}</span>
      </div>

      <Input
        type="text"
        placeholder="Search by part number..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="flex gap-2 overflow-x-auto pb-2">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setCategory(filter)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              category === filter ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredDrawings.map((drawing) => (
          <Card
            key={drawing.partNumber}
            className="py-0 cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => console.log('Open full-size drawing:', drawing.partNumber)}
          >
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-base">{drawing.partNumber}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <Image
                src={drawing.drawingUrl}
                alt={`${drawing.partNumber} drawing`}
                width={600}
                height={450}
                className="w-full aspect-[4/3] rounded-md border border-border bg-muted object-cover mb-3"
              />
              <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {drawing.category}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredDrawings.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-10">
          No drawings found for your current filters.
        </p>
      )}
    </div>
  )
}
