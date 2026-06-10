import { NextRequest, NextResponse } from 'next/server'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { forbidden } from '@/lib/pallets/api'
import { getOrders } from '@/lib/pallets/google'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { searchParams } = new URL(request.url)
    const includeCompleted = searchParams.get('include_completed') === 'true'
    return NextResponse.json(await getOrders(includeCompleted))
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Pallet orders API error:', msg)
    return NextResponse.json({ error: 'Failed to fetch orders', detail: msg }, { status: 500 })
  }
}
