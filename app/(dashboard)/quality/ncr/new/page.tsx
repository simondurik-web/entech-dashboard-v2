"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FieldError, InfoPill, QualityFormShell } from "@/components/quality/form-shell"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { toIntOrNull, userHeaders } from "@/lib/quality/form-utils"

type Product = {
  id: string
  product_number: string
  product_type: string
  hub_style: string | null
  hub_mold: string | null
}

const DEFECT_TYPES = ["visual", "dimensional", "weight", "bonding", "locking_pin", "contamination", "other"] as const
const DISPOSITIONS = ["HOLD", "SCRAP", "REWORK", "USE_AS_IS", "RETURN_TO_SUPPLIER"] as const

export default function NewNcrPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canSeeQuality } = useQualityAccess()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    product_type: "",
    product_number: "",
    mold_cavity: "",
    defect_type: "",
    defect_description: "",
    quantity_affected: "1",
    disposition: "HOLD",
    root_cause: "",
    corrective_action: "",
    preventive_action: "",
  })

  useEffect(() => {
    if (!canSeeQuality || !form.product_type) {
      setProducts([])
      return
    }
    let alive = true
    const productType = form.product_type === "finished" ? "finished_product" : form.product_type
    supabase
      .from("qa_products")
      .select("id, product_number, product_type, hub_style, hub_mold")
      .eq("product_type", productType)
      .order("product_number")
      .then(({ data }) => { if (alive) setProducts((data || []) as Product[]) })
    return () => { alive = false }
  }, [canSeeQuality, form.product_type])

  if (!canSeeQuality) return null

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  function handleProductTypeChange(value: string) {
    setForm((prev) => ({ ...prev, product_type: value, product_number: "", mold_cavity: "" }))
    setSelectedProduct(null)
    setError(null)
  }

  function handleProductSelect(productNumber: string) {
    const product = products.find((p) => p.product_number === productNumber) || null
    setSelectedProduct(product)
    updateField("product_number", productNumber)
  }

  const canSubmit = !!form.product_type && !!form.product_number && !!form.defect_type && !!form.defect_description && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      setError(t("quality.form.requiredFields"))
      return
    }
    const moldCavity = toIntOrNull(form.mold_cavity)
    const quantity = toIntOrNull(form.quantity_affected)
    if (!moldCavity.ok || !quantity.ok || (quantity.value ?? 1) < 1) {
      setError(t("quality.form.invalidNumber"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/quality/ncr", {
        method: "POST",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          product_type: form.product_type,
          product_number: form.product_number,
          hub_style: selectedProduct?.hub_style || null,
          hub_mold: selectedProduct?.hub_mold || null,
          mold_cavity: moldCavity.value,
          defect_type: form.defect_type,
          defect_description: form.defect_description,
          quantity_affected: quantity.value || 1,
          disposition: form.disposition,
          root_cause: form.root_cause || null,
          corrective_action: form.corrective_action || null,
          preventive_action: form.preventive_action || null,
        }),
      })
      if (res.ok) {
        router.push("/quality/ncr")
        return
      }
      setError(t("quality.form.submitError").replace("{code}", String(res.status)))
    } catch {
      setError(t("quality.form.networkError"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <QualityFormShell title={t("quality.form.ncrNew")} subtitle={t("quality.page.ncrSubtitle")} backHref="/quality/ncr" cardTitle={t("quality.form.ncrNew")}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label>{t("quality.col.productType")}</Label>
          <Select value={form.product_type || undefined} onValueChange={handleProductTypeChange}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectProductType")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hub">{t("quality.productType.hub")}</SelectItem>
              <SelectItem value="tire">{t("quality.productType.tire")}</SelectItem>
              <SelectItem value="finished">{t("quality.productType.finished")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.product_type && (
          <div className="space-y-2">
            <Label>{t("quality.col.product")}</Label>
            <Select value={form.product_number || undefined} onValueChange={handleProductSelect}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectProduct")} /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.product_number}>{p.product_number}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        {form.product_type === "hub" && selectedProduct && (
          <>
            <div className="flex flex-wrap gap-3">
              <InfoPill label={t("quality.col.hubStyle")} value={selectedProduct.hub_style} />
              <InfoPill label={t("quality.col.hubMold")} value={selectedProduct.hub_mold} />
            </div>
            <div className="space-y-2">
              <Label>{t("quality.col.moldCavity")}</Label>
              <Select value={form.mold_cavity || undefined} onValueChange={(v) => updateField("mold_cavity", v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectCavity")} /></SelectTrigger>
                <SelectContent>{["1", "2", "3", "4"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label>{t("quality.col.defectType")}</Label>
          <Select value={form.defect_type || undefined} onValueChange={(v) => updateField("defect_type", v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectDefectType")} /></SelectTrigger>
            <SelectContent>{DEFECT_TYPES.map((value) => <SelectItem key={value} value={value}>{t(`quality.defect.${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("quality.col.defectDescription")}</Label>
          <Textarea value={form.defect_description} onChange={(e) => updateField("defect_description", e.target.value)} rows={3} placeholder={t("quality.col.defectDescription")} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("quality.col.quantityAffected")}</Label>
            <Input type="number" min="1" inputMode="numeric" value={form.quantity_affected} onChange={(e) => updateField("quantity_affected", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("quality.col.disposition")}</Label>
            <Select value={form.disposition} onValueChange={(v) => updateField("disposition", v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectDisposition")} /></SelectTrigger>
              <SelectContent>{DISPOSITIONS.map((value) => <SelectItem key={value} value={value}>{t(`quality.disposition.${value}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t("quality.col.rootCause")}</Label>
          <Textarea value={form.root_cause} onChange={(e) => updateField("root_cause", e.target.value)} rows={2} placeholder={t("quality.col.rootCause")} />
        </div>
        <div className="space-y-2">
          <Label>{t("quality.col.correctiveAction")}</Label>
          <Textarea value={form.corrective_action} onChange={(e) => updateField("corrective_action", e.target.value)} rows={2} placeholder={t("quality.col.correctiveAction")} />
        </div>
        <div className="space-y-2">
          <Label>{t("quality.col.preventiveAction")}</Label>
          <Textarea value={form.preventive_action} onChange={(e) => updateField("preventive_action", e.target.value)} rows={2} placeholder={t("quality.col.preventiveAction")} />
        </div>
        <FieldError error={error} />
        <Button type="submit" disabled={!canSubmit} className="w-full">{submitting ? t("quality.form.submitting") : t("quality.form.submit")}</Button>
      </form>
    </QualityFormShell>
  )
}
