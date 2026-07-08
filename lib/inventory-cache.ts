'use client'

// Shared client-side /api/inventory cache. One fetch feeds every
// InventoryPopover on a page (they can render by the hundred in the order
// tables); EditableMinimum invalidates it after a minimum edit so hover cards
// never show a pre-edit value. Extracted from InventoryPopover 2026-07-08 so
// both components can share it without a circular import.

import type { InventoryItem } from '@/lib/google-sheets-shared'
import { cacheDeleteKey } from '@/lib/data-cache'

let inventoryCache: InventoryItem[] | null = null
let inventoryPromise: Promise<InventoryItem[]> | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60_000 // 1 minute

export async function getSharedInventory(): Promise<InventoryItem[]> {
  const now = Date.now()
  if (inventoryCache && now - cacheTimestamp < CACHE_TTL) return inventoryCache
  if (inventoryPromise) return inventoryPromise

  inventoryPromise = fetch('/api/inventory')
    .then((res) => res.json())
    .then((data: InventoryItem[]) => {
      inventoryCache = data
      cacheTimestamp = Date.now()
      inventoryPromise = null
      return data
    })
    .catch((err) => {
      inventoryPromise = null
      throw err
    })
  return inventoryPromise
}

/** Drop every stale client copy of the inventory payload: this module's shared
 *  cache AND the device cache (page revisits). Call after any mutation that
 *  changes inventory-derived numbers (e.g. a minimum edit). */
export function invalidateInventoryClientCaches(): void {
  inventoryCache = null
  cacheTimestamp = 0
  void cacheDeleteKey('/api/inventory')
}
