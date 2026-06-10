import type { QaLimitRow } from "@/lib/quality/limits"

export type ProductType = "hub" | "tire" | "finished_product"

export type MetricDef = {
  key: string
  labelKey: string
  unit?: string
}

export const PRODUCT_TYPES: ProductType[] = ["hub", "tire", "finished_product"]

export const METRICS_BY_TYPE: Record<ProductType, MetricDef[]> = {
  hub: [
    { key: "bore_size", labelKey: "quality.col.boreSize", unit: "mm" },
    { key: "bore_length", labelKey: "quality.col.boreLength", unit: "mm" },
    { key: "hub_diameter", labelKey: "quality.col.hubDiameter", unit: "mm" },
    { key: "weight", labelKey: "quality.col.weight", unit: "lbs" },
  ],
  tire: [
    { key: "thickness", labelKey: "quality.col.thickness", unit: "mm" },
    { key: "diameter", labelKey: "quality.col.diameter", unit: "mm" },
    { key: "weight", labelKey: "quality.col.weight", unit: "lbs" },
  ],
  finished_product: [
    { key: "tire_od", labelKey: "quality.col.tireOd", unit: "mm" },
    { key: "tire_thickness", labelKey: "quality.col.tireThickness", unit: "mm" },
    { key: "tire_weight", labelKey: "quality.col.tireWeight", unit: "lbs" },
  ],
}

export const PRODUCT_TYPE_LABEL_KEY: Record<ProductType, string> = {
  hub: "quality.productType.hub",
  tire: "quality.productType.tire",
  finished_product: "quality.productType.finished",
}

export type LimitRow = QaLimitRow & {
  id?: number
  updated_at?: string
  updated_by?: string | null
}

export function normalizeProductType(value: unknown): ProductType | null {
  if (value === "finished") return "finished_product"
  if (value === "hub" || value === "tire" || value === "finished_product") return value
  return null
}
