import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await supabaseAdmin
    .from('bom_final_assemblies')
    .select('part_number')
    .order('part_number')

  return NextResponse.json({
    count: result.data?.length ?? 0,
    error: result.error,
    sample: result.data?.slice(0, 5),
    has668: result.data?.filter(r => r.part_number.startsWith('668')),
  })
}
