import { NextRequest, NextResponse } from 'next/server'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { forbidden } from '@/lib/pallets/api'
import { getOrders } from '@/lib/pallets/google'
import { getStagingGates, isReadyForShipping } from '@/lib/pallets/staging-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { searchParams } = new URL(request.url)
    const includeCompleted = searchParams.get('include_completed') === 'true'

    // Include Staged orders so the pallet-photo gate can keep the ones that
    // aren't fully photographed here in Production. A Staged order only leaves
    // for Shipping once every expected pallet has a photo, or an admin forces
    // it — regardless of what ERPNext reports.
    const orders = await getOrders(includeCompleted, true)
    const stagedLines = orders.filter((o) => o.status === 'staged').map((o) => o.line_number)
    const gates = stagedLines.length ? await getStagingGates(stagedLines) : {}
    const gated = orders.filter((o) => {
      if (o.status !== 'staged') return true
      return !isReadyForShipping(o.num_pallets, gates[o.line_number])
    })
    return NextResponse.json(gated)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Pallet orders API error:', msg)
    return NextResponse.json({ error: 'Failed to fetch orders', detail: msg }, { status: 500 })
  }
}
