import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextFetchRaw } from '@/lib/erpnext/client'
import { getItemImagePath } from '@/lib/erpnext/fulfillment'

// GET /api/erpnext/fulfillment/item-image?item=<item code>
// Streams the Item's product picture. ERPNext's /files sits behind the
// Cloudflare Access gate, so the browser can't load the URL directly; this
// route fetches it server-side (CF service token + svc user) and forwards the
// bytes. Only the Item.image path of a real Item is ever proxied — never an
// arbitrary caller-supplied path. The client fetches with authedFetch and
// renders via a blob URL (an <img src> can't carry the Bearer token).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ITEM_CODE = /^[A-Za-z0-9 ._/-]{1,60}$/

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res

  const item = req.nextUrl.searchParams.get('item')?.trim() ?? ''
  if (!ITEM_CODE.test(item)) {
    return NextResponse.json({ error: 'Invalid item' }, { status: 400 })
  }
  try {
    const path = await getItemImagePath(item)
    if (!path) return NextResponse.json({ error: 'No image' }, { status: 404 })
    const upstream = await erpnextFetchRaw(encodeURI(path))
    const type = upstream.headers.get('content-type') ?? ''
    if (!upstream.ok || !type.startsWith('image/')) {
      return NextResponse.json({ error: 'No image' }, { status: 404 })
    }
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': type,
        // Product photos change rarely; let the device cache them for a day.
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('item image proxy failed:', error)
    return NextResponse.json({ error: 'Image unavailable' }, { status: 502 })
  }
}
