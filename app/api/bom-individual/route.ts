import { NextRequest, NextResponse } from 'next/server'
import { fetchBOMIndividual } from '@/lib/google-sheets'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const bom = await fetchBOMIndividual()
    return NextResponse.json(bom)
  } catch (error) {
    console.error('Failed to fetch individual BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch individual BOM data' },
      { status: 500 }
    )
  }
}
