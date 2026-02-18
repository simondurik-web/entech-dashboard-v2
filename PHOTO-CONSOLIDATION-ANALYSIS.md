# Photo Consolidation Analysis
**Date:** 2026-02-18

## The Problem
Photos are split across 3 separate Google Sheets:
1. **Pallet Pictures** — photos taken when palletizing (2,116 photos across 1,897 records)
2. **Staged Records** — photos when staged + fusion photos (359 photos across 788 records)
3. **Shipping Records** — shipment, paperwork, close-up photos (172 photos across 348 records)

These need to be consolidated into a unified view per order (by IF number).

## Data Summary

| Source | Records | Unique IFs | Photos |
|--------|---------|-----------|--------|
| Pallet Pictures | 1,897 | 346 | 2,116 |
| Staged Records | 788 | 373 | 359 |
| Shipping Records | 348 | 163 | 172 |
| **Total** | **3,033** | **665 unique** | **2,647** |
| Orders Data | 2,542 | 1,786 | - |

## IF Number Overlap

- **3 IFs** appear in all 3 sheets (full lifecycle tracked)
- **211 IFs** appear in 2 sheets
- **451 IFs** appear in 1 sheet only
- Pallet ∩ Staged: 133 IFs
- Pallet ∩ Shipping: 13 IFs
- Staged ∩ Shipping: 74 IFs

## Orders ↔ Photos Mapping

- **318 orders** (18%) have photos from at least one source
- 263 orders have pallet photos
- 186 orders have staged photos
- 14 orders have shipping photos
- **1,468 orders** (82%) have NO photos yet

## IF Number Patterns
- `IF######` — 339 (standard format, all in Orders sheet)
- `B2B#####` — 72 (B2B orders, separate numbering)
- Other — 254 (includes lowercase `if######`, `If######`, "test", "Cross reference not found")
- **Must use case-insensitive matching** (orders are always uppercase, but pallet/staged have mixed case)

## Photo Types Per Source

### Pallet Pictures
- `photos[]` — up to 5 pallet photos per record
- One record = one pallet for one IF
- An IF can have many pallets (e.g., IF152151 has 34 pallet records)

### Staged Records  
- `photos[]` — general staging photos
- `fusionPhotos[]` — fusion/welding photos

### Shipping Records
- `photos[]` — general shipping photos
- `shipmentPhotos[]` — loaded truck/shipment photos
- `paperworkPhotos[]` — BOL, labels, paperwork
- `closeUpPhotos[]` — detail/close-up shots

## Proposed Consolidation

### 1. Unified Photo API: `/api/order-photos/[ifNumber]`

Returns ALL photos for an IF number, grouped by category:

```json
{
  "ifNumber": "IF152151",
  "totalPhotos": 36,
  "categories": {
    "pallet": [
      { "url": "...", "palletNumber": "1", "timestamp": "...", "weight": "1029" },
      { "url": "...", "palletNumber": "2", "timestamp": "..." }
    ],
    "staging": [
      { "url": "...", "timestamp": "...", "type": "photo" }
    ],
    "fusion": [
      { "url": "...", "timestamp": "...", "type": "fusion" }
    ],
    "shipment": [
      { "url": "...", "timestamp": "...", "type": "shipment" }
    ],
    "paperwork": [
      { "url": "...", "timestamp": "...", "type": "paperwork" }
    ],
    "closeup": [
      { "url": "...", "timestamp": "...", "type": "closeup" }
    ]
  }
}
```

### 2. Photo Gallery Component: `<OrderPhotoGallery ifNumber="IF152151" />`

- Tabs or filter chips: All | Pallet | Staging | Fusion | Shipment | Paperwork
- Small thumbnails → hover enlarge → click fullscreen (existing PhotoGrid + Lightbox)
- Shows photo count badge per category
- Lazy-loaded per IF number (fetch on expand)

### 3. Integration Points

**Orders Data page** — Add expandable photo section in OrderDetail:
- Show camera icon + total photo count on each row
- Click to expand → shows OrderPhotoGallery

**Shipped page** — Same integration, shows full lifecycle photos

**Need to Package / Need to Make** — Show pallet + staging photos (if any)

**Ready to Ship** — Show all pre-shipping photos

### 4. Matching Logic

```
normalize(ifNumber):
  1. Trim whitespace
  2. Uppercase
  3. Skip if "TEST" or "CROSS REFERENCE NOT FOUND"
  
Match order.ifNumber against:
  - palletRecords[].ifNumber (case-insensitive)
  - stagedRecords[].ifNumber (case-insensitive)
  - shippingRecords[].ifNumber (case-insensitive)
```

### 5. Implementation Steps

1. **Create `/api/order-photos/[ifNumber]/route.ts`** — consolidation endpoint
2. **Create `<OrderPhotoGallery />` component** — tabbed gallery
3. **Add to OrderDetail** — show gallery when expanded
4. **Add photo count to order rows** — camera icon + count
5. **Same for Shipped page** — full lifecycle view

### 6. Future: Supabase Consolidation

Once all data moves to Supabase, create a `order_photos` view:
```sql
CREATE VIEW order_photos AS
  SELECT if_number, 'pallet' as category, public_url, migrated_at as timestamp
  FROM photo_mappings WHERE photo_type = 'pallet'
  UNION ALL
  SELECT if_number, photo_type as category, public_url, migrated_at
  FROM photo_mappings WHERE photo_type IN ('fusion', 'paperwork', 'shipment', 'closeup');
```
This eliminates the need to query 3 separate sheet APIs.
