'use client'

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function InventoryPage() {
  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Inventory</h1>
      
      {/* Search bar */}
      <input 
        type="text" 
        placeholder="🔍 Search inventory..." 
        className="w-full p-3 mb-4 rounded-lg bg-muted border border-border"
      />
      
      {/* Filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <span className="px-3 py-1 bg-primary text-primary-foreground rounded-full text-sm whitespace-nowrap">All</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">⚠️ Low Stock</span>
        <span className="px-3 py-1 bg-muted rounded-full text-sm whitespace-nowrap">🔧 Needs Production</span>
      </div>
      
      {/* Sample inventory cards */}
      <div className="space-y-3">
        {[
          { part: '255', product: 'Tire', stock: 1070, min: 2000, status: 'low' },
          { part: '308', product: 'Tire', stock: 4175, min: 9000, status: 'low' },
          { part: 'BEARING-TOPHAT', product: 'Bearing', stock: 3069, min: 5000, status: 'low' },
        ].map((item, i) => (
          <Card key={i} className={`border-l-4 ${item.status === 'low' ? 'border-l-yellow-500' : 'border-l-green-500'}`}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{item.part}</CardTitle>
                  <p className="text-sm text-muted-foreground">{item.product}</p>
                </div>
                <span className={`px-2 py-1 text-xs rounded ${
                  item.status === 'low' 
                    ? 'bg-yellow-500/20 text-yellow-600' 
                    : 'bg-green-500/20 text-green-600'
                }`}>
                  {item.status === 'low' ? 'LOW' : 'OK'}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">In Stock</span>
                  <p className={`font-semibold ${item.status === 'low' ? 'text-red-500' : 'text-green-500'}`}>
                    {item.stock.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Minimum</span>
                  <p className="font-semibold">{item.min.toLocaleString()}</p>
                </div>
              </div>
              <div className="mt-2">
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${item.status === 'low' ? 'bg-yellow-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min((item.stock / item.min) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {Math.round((item.stock / item.min) * 100)}% of minimum
                </p>
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
