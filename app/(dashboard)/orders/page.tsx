'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function OrdersPage() {
  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Orders</h1>
      
      {/* Filter chips placeholder */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <span className="px-3 py-1 bg-primary text-primary-foreground rounded-full text-sm whitespace-nowrap">All</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🔴 Urgent</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">📅 Due This Week</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🔵 Roll Tech</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🟡 Molding</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🟣 Snap Pad</span>
      </div>
      
      {/* Sample order cards */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">Sample Customer {i}</CardTitle>
                  <p className="text-sm text-muted-foreground">Line 245{i} • PART-{i}23</p>
                </div>
                <span className="px-2 py-1 bg-yellow-500/20 text-yellow-600 text-xs rounded">PENDING</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Quantity</span>
                  <p className="font-semibold">{i * 1500}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Due</span>
                  <p className="font-semibold">{i + 2} days</p>
                </div>
              </div>
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
