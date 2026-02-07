'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function StagedPage() {
  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Staged Orders</h1>
      
      {/* Filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <span className="px-3 py-1 bg-primary text-primary-foreground rounded-full text-sm whitespace-nowrap">All</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🔵 Roll Tech</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🟡 Molding</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🟣 Snap Pad</span>
      </div>
      
      {/* Sample staged cards */}
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Card key={i} className="border-l-4 border-l-emerald-500">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">DCE Solar</CardTitle>
                  <p className="text-sm text-muted-foreground">Line 245{i} • PADASM-8X18</p>
                </div>
                <span className="px-2 py-1 bg-emerald-500/20 text-emerald-600 text-xs rounded">STAGED</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Quantity</span>
                  <p className="font-semibold">{i * 1000 + 500}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">IF #</span>
                  <p className="font-semibold">IF15226{i}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">📦 Ready to ship</p>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <p className="text-center text-muted-foreground mt-8 text-sm">
        🔄 Connect to Google Sheets for live data
      </p>
    </div>
  )
}
