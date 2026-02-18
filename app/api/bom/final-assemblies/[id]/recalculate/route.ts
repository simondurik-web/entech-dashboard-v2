import { NextResponse } from 'next/server'
import { recalculateFinalAssembly } from '@/lib/bom-recalculate'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const updated = await recalculateFinalAssembly(id)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}
