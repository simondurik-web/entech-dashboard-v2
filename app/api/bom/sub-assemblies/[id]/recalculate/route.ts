import { NextResponse } from 'next/server'
import { recalculateSubAssembly, recalculateCascade } from '@/lib/bom-recalculate'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const updated = await recalculateSubAssembly(id)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await recalculateCascade('sub_assembly', id)
  return NextResponse.json(updated)
}
