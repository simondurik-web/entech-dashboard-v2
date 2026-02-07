'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ChevronRight, Package, Layers, DollarSign, Search } from 'lucide-react'

// Mock BOM data structure
interface BOMComponent {
  partNumber: string
  description: string
  quantity: number
  unit: string
  costPerUnit: number
  category: 'raw' | 'component' | 'assembly'
  children?: BOMComponent[]
}

interface BOMItem {
  partNumber: string
  product: string
  category: string
  components: BOMComponent[]
  totalCost: number
}

// Mock BOM data - will be fetched from Google Sheets later
const MOCK_BOM_DATA: BOMItem[] = [
  {
    partNumber: 'RT-1001',
    product: 'Roll Tech Tire 8"',
    category: 'Roll Tech',
    totalCost: 45.50,
    components: [
      {
        partNumber: 'CR-001',
        description: 'Crumb Rubber - Fine',
        quantity: 2.5,
        unit: 'lbs',
        costPerUnit: 0.85,
        category: 'raw',
      },
      {
        partNumber: 'PU-001',
        description: 'Polyurethane Binder',
        quantity: 0.5,
        unit: 'lbs',
        costPerUnit: 12.00,
        category: 'raw',
      },
      {
        partNumber: 'HUB-001',
        description: 'Aluminum Hub 8"',
        quantity: 1,
        unit: 'ea',
        costPerUnit: 18.50,
        category: 'component',
      },
      {
        partNumber: 'BRG-001',
        description: 'Sealed Bearing 5/8"',
        quantity: 2,
        unit: 'ea',
        costPerUnit: 4.25,
        category: 'component',
      },
    ],
  },
  {
    partNumber: 'RT-1002',
    product: 'Roll Tech Tire 10"',
    category: 'Roll Tech',
    totalCost: 58.75,
    components: [
      {
        partNumber: 'CR-001',
        description: 'Crumb Rubber - Fine',
        quantity: 3.5,
        unit: 'lbs',
        costPerUnit: 0.85,
        category: 'raw',
      },
      {
        partNumber: 'PU-001',
        description: 'Polyurethane Binder',
        quantity: 0.75,
        unit: 'lbs',
        costPerUnit: 12.00,
        category: 'raw',
      },
      {
        partNumber: 'HUB-002',
        description: 'Aluminum Hub 10"',
        quantity: 1,
        unit: 'ea',
        costPerUnit: 24.00,
        category: 'component',
      },
      {
        partNumber: 'BRG-002',
        description: 'Sealed Bearing 3/4"',
        quantity: 2,
        unit: 'ea',
        costPerUnit: 5.50,
        category: 'component',
      },
    ],
  },
  {
    partNumber: 'MP-2001',
    product: 'Molded Paver 12x12',
    category: 'Molding',
    totalCost: 8.25,
    components: [
      {
        partNumber: 'CR-002',
        description: 'Crumb Rubber - Coarse',
        quantity: 4.0,
        unit: 'lbs',
        costPerUnit: 0.65,
        category: 'raw',
      },
      {
        partNumber: 'PU-002',
        description: 'MDI Binder',
        quantity: 0.8,
        unit: 'lbs',
        costPerUnit: 8.50,
        category: 'raw',
      },
      {
        partNumber: 'COL-001',
        description: 'Color Pigment - Black',
        quantity: 0.1,
        unit: 'lbs',
        costPerUnit: 15.00,
        category: 'raw',
      },
    ],
  },
  {
    partNumber: 'SP-3001',
    product: 'Snap Pad 4x4',
    category: 'Snap Pad',
    totalCost: 3.50,
    components: [
      {
        partNumber: 'CR-002',
        description: 'Crumb Rubber - Coarse',
        quantity: 1.5,
        unit: 'lbs',
        costPerUnit: 0.65,
        category: 'raw',
      },
      {
        partNumber: 'PU-002',
        description: 'MDI Binder',
        quantity: 0.3,
        unit: 'lbs',
        costPerUnit: 8.50,
        category: 'raw',
      },
    ],
  },
]

function getCategoryColor(category: BOMComponent['category']) {
  switch (category) {
    case 'raw':
      return 'bg-amber-500/20 text-amber-600'
    case 'component':
      return 'bg-blue-500/20 text-blue-600'
    case 'assembly':
      return 'bg-purple-500/20 text-purple-600'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function getCategoryLabel(category: BOMComponent['category']) {
  switch (category) {
    case 'raw':
      return 'Raw Material'
    case 'component':
      return 'Component'
    case 'assembly':
      return 'Sub-Assembly'
    default:
      return category
  }
}

export default function BOMExplorerPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPart, setSelectedPart] = useState<BOMItem | null>(null)

  const filteredParts = useMemo(() => {
    if (!searchTerm) return MOCK_BOM_DATA
    const term = searchTerm.toLowerCase()
    return MOCK_BOM_DATA.filter(
      (item) =>
        item.partNumber.toLowerCase().includes(term) ||
        item.product.toLowerCase().includes(term)
    )
  }, [searchTerm])

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📋 BOM Explorer</h1>
      <p className="text-muted-foreground text-sm mb-4">
        Bill of Materials breakdown by product
      </p>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Part selector panel */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="size-4" />
              Select Product
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search parts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-[500px] overflow-y-auto space-y-1">
              {filteredParts.map((item) => (
                <button
                  key={item.partNumber}
                  onClick={() => setSelectedPart(item)}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between ${
                    selectedPart?.partNumber === item.partNumber
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted'
                  }`}
                >
                  <div>
                    <p className="font-medium text-sm">{item.partNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.product}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))}
              {filteredParts.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-4">
                  No parts found
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* BOM details panel */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedPart ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <Layers className="size-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Select a product to view its Bill of Materials
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Product header */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl">{selectedPart.partNumber}</CardTitle>
                      <p className="text-muted-foreground">{selectedPart.product}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total Cost</p>
                      <p className="text-2xl font-bold text-green-600">
                        ${selectedPart.totalCost.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Components breakdown */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="size-4" />
                    Components ({selectedPart.components.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {selectedPart.components.map((component, idx) => (
                      <div
                        key={component.partNumber + idx}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(
                              component.category
                            )}`}
                          >
                            {getCategoryLabel(component.category)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{component.partNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {component.description}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {component.quantity} {component.unit}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                            <DollarSign className="size-3" />
                            {(component.quantity * component.costPerUnit).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Cost breakdown summary */}
                  <div className="mt-4 pt-4 border-t">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">Raw Materials</p>
                        <p className="text-lg font-semibold text-amber-600">
                          $
                          {selectedPart.components
                            .filter((c) => c.category === 'raw')
                            .reduce((sum, c) => sum + c.quantity * c.costPerUnit, 0)
                            .toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Components</p>
                        <p className="text-lg font-semibold text-blue-600">
                          $
                          {selectedPart.components
                            .filter((c) => c.category === 'component')
                            .reduce((sum, c) => sum + c.quantity * c.costPerUnit, 0)
                            .toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-lg font-semibold text-green-600">
                          ${selectedPart.totalCost.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
