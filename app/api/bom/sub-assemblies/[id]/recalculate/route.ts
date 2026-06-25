import { NextRequest, NextResponse } from 'next/server'
import { recalculateSubAssembly, recalculateCascade } from '@/lib/bom-recalculate'
import { requireUser } from '@/lib/require-user'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const updated = await recalculateSubAssembly(id)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await recalculateCascade('sub_assembly', id)
  return NextResponse.json(updated)
}
