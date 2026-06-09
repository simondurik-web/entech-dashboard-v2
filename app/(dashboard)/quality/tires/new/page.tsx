"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FieldError, QualityFormShell, TargetPanel } from "@/components/quality/form-shell"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { toFiniteOrNull, userHeaders } from "@/lib/quality/form-utils"

type Product = {
  id: string
  product_number: string
  thickness_target: number | null
  diameter_target: number | null
  weight_target: number | null
}

export default function NewTireInspectionPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canSeeQuality } = useQualityAccess()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ tire_number: "", thickness: "", diameter: "", weight: "", visual_inspection: "", comments: "" })

  useEffect(() => {
    if (!canSeeQuality) return
    let alive = true
    supabase
      .from("qa_products")
      .select("id, product_number, thickness_target, diameter_target, weight_target")
      .eq("product_type", "tire")
      .order("product_number")
      .then(({ data }) => { if (alive) setProducts((data || []) as Product[]) })
    return () => { alive = false }
  }, [canSeeQuality])

  if (!canSeeQuality) return null

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  function handleProductSelect(productNumber: string) {
    const product = products.find((p) => p.product_number === productNumber) || null
    setSelectedProduct(product)
    updateField("tire_number", productNumber)
  }

  const canSubmit = !!form.tire_number && ["PASS", "FAIL"].includes(form.visual_inspection) && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      setError(t("quality.form.requiredFields"))
      return
    }
    const thickness = toFiniteOrNull(form.thickness)
    const diameter = toFiniteOrNull(form.diameter)
    const weight = toFiniteOrNull(form.weight)
    if (!thickness.ok || !diameter.ok || !weight.ok) {
      setError(t("quality.form.invalidNumber"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/quality/inspections/tires", {
        method: "POST",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          tire_number: form.tire_number,
          thickness: thickness.value,
          thickness_target: selectedProduct?.thickness_target ?? null,
          diameter: diameter.value,
          diameter_target: selectedProduct?.diameter_target ?? null,
          weight: weight.value,
          weight_target: selectedProduct?.weight_target ?? null,
          visual_inspection: form.visual_inspection,
          comments: form.comments,
        }),
      })
      if (res.ok) {
        router.push("/quality/tires")
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
    <QualityFormShell title={t("quality.form.tireNew")} subtitle={t("quality.form.newInspection")} backHref="/quality/tires" cardTitle={t("quality.form.newInspection")}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label>{t("quality.col.tireNumber")}</Label>
          <Select value={form.tire_number || undefined} onValueChange={handleProductSelect}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectTire")} /></SelectTrigger>
            <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.product_number}>{p.product_number}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {selectedProduct && (
          <TargetPanel title={t("quality.form.target")}>
            <span>{t("quality.col.thickness")}: {selectedProduct.thickness_target ?? "—"}</span>
            <span>{t("quality.col.diameter")}: {selectedProduct.diameter_target ?? "—"}</span>
            <span>{t("quality.col.weight")}: {selectedProduct.weight_target ?? "—"}</span>
          </TargetPanel>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(["thickness", "diameter", "weight"] as const).map((key) => (
            <div key={key} className="space-y-2">
              <Label>{t(`quality.col.${key}`)}</Label>
              <Input type="number" step="0.001" inputMode="decimal" value={form[key]} onChange={(e) => updateField(key, e.target.value)} placeholder={t("quality.form.measurement")} />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>{t("quality.col.visualInspection")}</Label>
          <Select value={form.visual_inspection || undefined} onValueChange={(v) => updateField("visual_inspection", v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.select")} /></SelectTrigger>
            <SelectContent><SelectItem value="PASS">PASS</SelectItem><SelectItem value="FAIL">FAIL</SelectItem></SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("quality.col.comments")}</Label>
          <Textarea value={form.comments} onChange={(e) => updateField("comments", e.target.value)} placeholder={t("quality.form.commentsPlaceholder")} rows={3} />
        </div>
        <FieldError error={error} />
        <Button type="submit" disabled={!canSubmit} className="w-full">{submitting ? t("quality.form.submitting") : t("quality.form.submit")}</Button>
      </form>
    </QualityFormShell>
  )
}
