import { NextRequest, NextResponse } from 'next/server'
import { recalculateFinalAssembly } from '@/lib/bom-recalculate'
import { requireUser } from '@/lib/require-user'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const updated = await recalculateFinalAssembly(id)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}
