'use client'

import { useEffect, useState, useCallback } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { useI18n } from '@/lib/i18n'

// Sentinel "customer" for ad-hoc quotes: no customer record, parts picked
// from the full catalog, prices typed manually (Simon 2026-06-11 — quoting
// new business without mapping a customer first).
const GENERIC_CUSTOMER_ID = '__generic__'

interface CatalogPart {
  partNumber: string
  category: string | null
}

interface Customer {
  id: string
  name: string
  payment_terms: string
  notes: string | null
}

interface Product {
  id: string
  customer_part_number: string | null
  internal_part_number: string
  category: string | null
  package_quantity: string | null
  packaging: string | null
  tier1_range: string | null; tier1_price: number | null
  tier2_range: string | null; tier2_price: number | null
  tier3_range: string | null; tier3_price: number | null
  tier4_range: string | null; tier4_price: number | null
  tier5_range: string | null; tier5_price: number | null
}

interface Tier {
  min: number
  price: number
  rangeText: string
}

interface QuoteItem {
  id: number
  product: Product | null
  // Generic mode: free-typed or catalog-picked part number (product stays null)
  partNumber: string
  displayMode: 'tiers' | 'quantity'
  quantity: number
  unitPrice: number
  total: number
  tiers: Tier[]
}

function parseTiers(p: Product): Tier[] {
  const tiers: Tier[] = []
  for (let i = 1; i <= 5; i++) {
    const range = p[`tier${i}_range` as keyof Product] as string | null
    const price = p[`tier${i}_price` as keyof Product] as number | null
    if (range && price != null && price > 0) {
      const min = parseInt(String(range).replace(/[^0-9]/g, '')) || 0
      tiers.push({ min, price, rangeText: `${min.toLocaleString()}+` })
    }
  }
  return tiers
}

function calcUnitPrice(tiers: Tier[], qty: number): number {
  let price = 0
  for (const t of tiers) {
    if (qty >= t.min) price = t.price
  }
  return price
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function NewQuotePage() {
  const { t } = useI18n()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [genericMode, setGenericMode] = useState(false)
  const [prospectName, setProspectName] = useState('')
  const [catalog, setCatalog] = useState<CatalogPart[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [items, setItems] = useState<QuoteItem[]>([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ quoteNumber: string; pdfUrl: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [itemCounter, setItemCounter] = useState(0)

  useEffect(() => {
    fetch('/api/customers')
      .then(r => r.json())
      .then(setCustomers)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleCustomerChange = useCallback(async (customerId: string) => {
    setItems([])
    setProducts([])

    if (customerId === GENERIC_CUSTOMER_ID) {
      setGenericMode(true)
      setSelectedCustomer(null)
      try {
        const res = await fetch('/api/parts-catalog')
        const data = await res.json()
        if (Array.isArray(data)) setCatalog(data)
      } catch {
        // free-text part entry still works without the catalog
      }
      return
    }

    setGenericMode(false)
    const customer = customers.find(c => c.id === customerId) || null
    setSelectedCustomer(customer)

    if (customer) {
      try {
        const res = await fetch(`/api/customer-products?customerId=${customer.id}`)
        const data = await res.json()
        setProducts(data)
      } catch (e) {
        setError('Failed to load products')
      }
    }
  }, [customers])

  const addItem = useCallback(() => {
    const newId = itemCounter + 1
    setItemCounter(newId)
    setItems(prev => [...prev, {
      id: newId,
      product: null,
      partNumber: '',
      // Generic quotes are always qty × manual price — tiers need a customer mapping
      displayMode: genericMode ? 'quantity' : 'tiers',
      quantity: 0,
      unitPrice: 0,
      total: 0,
      tiers: [],
    }])
  }, [itemCounter, genericMode])

  const addAllProducts = useCallback(() => {
    const existingProductIds = new Set(items.map(i => i.product?.id).filter(Boolean))
    const newProducts = products.filter(p => !existingProductIds.has(p.id))
    if (newProducts.length === 0) return
    let counter = itemCounter
    const newItems: QuoteItem[] = newProducts.map(product => {
      counter++
      const tiers = parseTiers(product)
      return {
        id: counter,
        product,
        partNumber: '',
        displayMode: 'tiers' as const,
        quantity: 0,
        unitPrice: 0,
        total: 0,
        tiers,
      }
    })
    setItemCounter(counter)
    setItems(prev => [...prev, ...newItems])
  }, [products, items, itemCounter])

  const removeItem = useCallback((id: number) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const updateItemProduct = useCallback((id: number, productId: string) => {
    const product = products.find(p => p.id === productId) || null
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const tiers = product ? parseTiers(product) : []
      return { ...item, product, tiers, quantity: 0, unitPrice: 0, total: 0 }
    }))
  }, [products])

  const updateItemMode = useCallback((id: number, mode: 'tiers' | 'quantity') => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, displayMode: mode } : item
    ))
  }, [])

  const updateItemQuantity = useCallback((id: number, qty: number) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const unitPrice = calcUnitPrice(item.tiers, qty)
      return { ...item, quantity: qty, unitPrice, total: qty * unitPrice }
    }))
  }, [])

  // ── Generic-mode item handlers (manual part number + manual price) ──
  const updateGenericPart = useCallback((id: number, partNumber: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, partNumber } : item
    ))
  }, [])

  const updateGenericQty = useCallback((id: number, qty: number) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, quantity: qty, total: qty * item.unitPrice } : item
    ))
  }, [])

  const updateGenericPrice = useCallback((id: number, price: number) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, unitPrice: price, total: item.quantity * price } : item
    ))
  }, [])

  const totalAmount = items.reduce((sum, i) => sum + (i.displayMode === 'quantity' ? i.total : 0), 0)

  const handleGenerate = useCallback(async () => {
    if (!genericMode && !selectedCustomer) return setError('Select a customer')
    if (genericMode && !prospectName.trim()) return setError(t('quotes.genericNameRequired'))

    const validItems = genericMode
      ? items.filter(i => i.partNumber.trim())
      : items.filter(i => i.product)
    if (validItems.length === 0) return setError('Add at least one product')
    if (genericMode && validItems.some(i => i.quantity <= 0 || i.unitPrice <= 0)) {
      return setError(t('quotes.genericPriceRequired'))
    }

    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/quotes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genericMode ? {
          customerName: prospectName.trim(),
          paymentTerms: '',
          notes,
          totalAmount,
          items: validItems.map(i => ({
            internalPartNumber: i.partNumber.trim(),
            customerPartNumber: '',
            displayMode: 'quantity',
            tiers: [],
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total,
          })),
        } : {
          customerName: selectedCustomer!.name,
          customerId: selectedCustomer!.id,
          paymentTerms: selectedCustomer!.payment_terms,
          notes,
          totalAmount,
          items: validItems.map(i => ({
            internalPartNumber: i.product!.internal_part_number,
            customerPartNumber: i.product!.customer_part_number || '',
            displayMode: i.displayMode,
            tiers: i.tiers,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.total,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate')
      setResult(data)
      window.open(data.pdfUrl, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate quote')
    } finally {
      setGenerating(false)
    }
  }, [genericMode, prospectName, selectedCustomer, items, notes, totalAmount, t])

  if (loading) {
    return (
      <TableSkeleton rows={8} />
    )
  }

  return (
    <div className="p-4 pb-20 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">📝 Create New Quote</h1>
          <p className="text-muted-foreground text-sm">Generate a professional quote PDF</p>
        </div>
        <a href="/quotes" className="text-sm text-blue-400 hover:underline">← Back to Quotes</a>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-400 p-3 rounded mb-4">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">✕</button>
        </div>
      )}

      {result && (
        <div className="bg-green-900/30 border border-green-700 text-green-400 p-4 rounded mb-4">
          <p className="font-bold">✅ Quote {result.quoteNumber} generated!</p>
          <a href={result.pdfUrl} target="_blank" rel="noopener" className="text-blue-400 hover:underline text-sm">
            View PDF →
          </a>
        </div>
      )}

      {/* Customer Selection */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <h2 className="font-semibold mb-3">👤 Customer Selection</h2>
        <select
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
          value={genericMode ? GENERIC_CUSTOMER_ID : (selectedCustomer?.id || '')}
          onChange={e => handleCustomerChange(e.target.value)}
        >
          <option value="">-- Select Customer --</option>
          <option value={GENERIC_CUSTOMER_ID}>✏️ {t('quotes.genericOption')}</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {genericMode && (
          <div className="mt-3">
            <input
              type="text"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white"
              placeholder={t('quotes.genericNamePlaceholder')}
              value={prospectName}
              onChange={e => setProspectName(e.target.value)}
            />
            <p className="mt-2 text-xs text-zinc-500">{t('quotes.genericHint')}</p>
          </div>
        )}

        {selectedCustomer && (
          <div className="mt-3 bg-blue-900/20 border border-blue-800 rounded p-3">
            <span className="text-sm text-blue-400">
              <strong>Payment Terms:</strong> {selectedCustomer.payment_terms}
            </span>
          </div>
        )}
      </div>

      {/* Products */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <h2 className="font-semibold mb-3">📦 Products</h2>

        {genericMode && items.map(item => (
          <div key={item.id} className="border border-zinc-700 rounded p-4 mb-3 relative">
            <button
              onClick={() => removeItem(item.id)}
              className="absolute top-2 right-3 text-red-400 hover:text-red-300 text-xl font-bold"
            >✕</button>

            <input
              type="text"
              list="parts-catalog-list"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white mb-3"
              placeholder={t('quotes.genericPartPlaceholder')}
              value={item.partNumber}
              onChange={e => updateGenericPart(item.id, e.target.value)}
            />

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t('quotes.genericQty')}</label>
                <input
                  type="number"
                  min={0}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white w-32"
                  placeholder="0"
                  value={item.quantity || ''}
                  onChange={e => updateGenericQty(item.id, parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t('quotes.genericUnitPrice')}</label>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white w-32"
                    placeholder="0.00"
                    value={item.unitPrice || ''}
                    onChange={e => updateGenericPrice(item.id, parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
              {item.quantity > 0 && item.unitPrice > 0 && (
                <div className="font-bold text-red-400 pb-2">
                  {formatCurrency(item.total)} ({formatCurrency(item.unitPrice)}/ea)
                </div>
              )}
            </div>
          </div>
        ))}

        {genericMode && (
          <datalist id="parts-catalog-list">
            {catalog.map(p => (
              <option key={p.partNumber} value={p.partNumber}>
                {p.category ? `${p.partNumber} — ${p.category}` : p.partNumber}
              </option>
            ))}
          </datalist>
        )}

        {!genericMode && items.map(item => (
          <div key={item.id} className="border border-zinc-700 rounded p-4 mb-3 relative">
            <button
              onClick={() => removeItem(item.id)}
              className="absolute top-2 right-3 text-red-400 hover:text-red-300 text-xl font-bold"
            >✕</button>

            <select
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white mb-3"
              value={item.product?.id || ''}
              onChange={e => updateItemProduct(item.id, e.target.value)}
            >
              <option value="">-- Select Product --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.internal_part_number}{p.customer_part_number ? ` (${p.customer_part_number})` : ''}
                </option>
              ))}
            </select>

            {item.product && (
              <>
                <div className="flex gap-4 mb-3">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`mode_${item.id}`}
                      checked={item.displayMode === 'tiers'}
                      onChange={() => updateItemMode(item.id, 'tiers')}
                      className="accent-red-500"
                    />
                    Show Tiers
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`mode_${item.id}`}
                      checked={item.displayMode === 'quantity'}
                      onChange={() => updateItemMode(item.id, 'quantity')}
                      className="accent-red-500"
                    />
                    Quantity
                  </label>
                </div>

                {item.displayMode === 'tiers' && (
                  <div className="text-sm text-zinc-400">
                    <strong>Tiers:</strong>
                    {item.tiers.map((t, i) => (
                      <div key={i}>{t.rangeText}: {formatCurrency(t.price)}/ea</div>
                    ))}
                    {item.tiers.length === 0 && <div className="text-zinc-500 italic">No tiers configured</div>}
                  </div>
                )}

                {item.displayMode === 'quantity' && (
                  <div>
                    <input
                      type="number"
                      className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white w-40"
                      placeholder="Enter quantity"
                      value={item.quantity || ''}
                      onChange={e => updateItemQuantity(item.id, parseInt(e.target.value) || 0)}
                    />
                    {item.quantity > 0 && item.unitPrice > 0 && (
                      <div className="mt-2 font-bold text-red-400">
                        {formatCurrency(item.total)} ({formatCurrency(item.unitPrice)}/ea)
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={addItem}
            disabled={genericMode ? false : (!selectedCustomer || products.length === 0)}
            className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ➕ Add Product
          </button>
          {!genericMode && (
            <button
              onClick={addAllProducts}
              disabled={!selectedCustomer || products.length === 0}
              className="px-4 py-2 bg-blue-900/40 border border-blue-700 rounded text-sm text-blue-300 hover:bg-blue-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ➕➕ Add All Products
            </button>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <h2 className="font-semibold mb-3">📝 Notes</h2>
        <textarea
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white min-h-[60px]"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes..."
        />
      </div>

      {/* Summary & Generate */}
      {totalAmount > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <div className="text-right text-lg font-bold text-green-400">
            Total: {formatCurrency(totalAmount)}
          </div>
        </div>
      )}

      <div className="text-center">
        <button
          onClick={handleGenerate}
          disabled={generating || (genericMode
            ? (!prospectName.trim() || items.filter(i => i.partNumber.trim()).length === 0)
            : (!selectedCustomer || items.filter(i => i.product).length === 0))}
          className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg text-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? '⏳ Generating...' : '🚀 Generate Quote'}
        </button>
      </div>
    </div>
  )
}
