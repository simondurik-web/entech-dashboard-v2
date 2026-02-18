import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { recalculateFinalAssembly } from '@/lib/bom-recalculate'

export async function GET() {
  const { data, error } = await supabaseAdmin.from('bom_config').select('*').order('key')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: Request) {
  const body = await req.json()
  const { configs, apply_to_all } = body as { configs: Array<{ key: string; value: number }>; apply_to_all?: boolean }

  for (const cfg of configs) {
    await supabaseAdmin
      .from('bom_config')
      .update({ value: cfg.value, updated_at: new Date().toISOString() })
      .eq('key', cfg.key)
  }

  if (apply_to_all) {
    // Build update object from config values
    const configMap: Record<string, number> = {}
    configs.forEach(c => { configMap[c.key] = c.value })

    const updateData: Record<string, number> = {}
    if (configMap.overhead_pct !== undefined) updateData.overhead_pct = configMap.overhead_pct
    if (configMap.admin_pct !== undefined) updateData.admin_pct = configMap.admin_pct
    if (configMap.depreciation_pct !== undefined) updateData.depreciation_pct = configMap.depreciation_pct
    if (configMap.repairs_pct !== undefined) updateData.repairs_pct = configMap.repairs_pct
    if (configMap.profit_target_pct !== undefined) updateData.profit_target_pct = configMap.profit_target_pct

    if (Object.keys(updateData).length > 0) {
      await supabaseAdmin.from('bom_final_assemblies').update(updateData).neq('id', '00000000-0000-0000-0000-000000000000')
    }

    // Recalculate all final assemblies
    const { data: assemblies } = await supabaseAdmin.from('bom_final_assemblies').select('id')
    if (assemblies) {
      for (const a of assemblies) {
        await recalculateFinalAssembly(a.id)
      }
    }
  }

  const { data } = await supabaseAdmin.from('bom_config').select('*').order('key')
  return NextResponse.json(data)
}
