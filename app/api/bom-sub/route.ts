import { NextRequest, NextResponse } from 'next/server'
import { fetchBOMSub } from '@/lib/google-sheets'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const bom = await fetchBOMSub()
    return NextResponse.json(bom)
  } catch (error) {
    console.error('Failed to fetch sub-assembly BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sub-assembly BOM data' },
      { status: 500 }
    )
  }
}
