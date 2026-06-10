import { supabase } from "@/lib/supabase"

export interface BOMMapping {
  rtNumber: string
  tire: string | null
  hub: string | null
}

let cachedMappings: BOMMapping[] | null = null

export async function getBOMMappings(): Promise<BOMMapping[]> {
  if (cachedMappings) return cachedMappings

  const { data } = await supabase
    .from("bom_final_assemblies")
    .select("part_number, description")
    .eq("product_category", "Roll tech")
    .limit(200)

  if (!data) return []

  const mappings: BOMMapping[] = data.map((row) => {
    const parts = (row.description || "").split(",").map((part: string) => part.trim())
    let tire: string | null = null
    let hub: string | null = null
    for (const part of parts) {
      if (/^\d{3}$/.test(part)) tire = part
      else if (part.startsWith("H") && part.includes(".")) hub = part
    }
    return { rtNumber: row.part_number, tire, hub }
  })

  cachedMappings = mappings
  return mappings
}
