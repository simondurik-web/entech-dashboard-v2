"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { QualityFormShell, FieldError, InfoPill, TargetPanel } from "@/components/quality/form-shell"
import { DrawingViewer } from "@/components/quality/drawing-viewer"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { toFiniteOrNull, toIntOrNull, userHeaders } from "@/lib/quality/form-utils"

type Product = {
  id: string
  product_number: string
  bore_size_target: number | null
  bore_length_target: number | null
  hub_diameter_target: number | null
  weight_target: number | null
  hub_style: string | null
  hub_mold: string | null
}

export default function NewHubInspectionPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canSeeQuality } = useQualityAccess()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    hub_number: "",
    hub_style: "",
    mold_cavity: "",
    bore_size: "",
    bore_length: "",
    hub_diameter: "",
    weight: "",
    locking_mechanism: "",
    visual_inspection: "",
    comments: "",
  })

  useEffect(() => {
    if (!canSeeQuality) return
    let alive = true
    supabase
      .from("qa_products")
      .select("id, product_number, bore_size_target, bore_length_target, hub_diameter_target, weight_target, hub_style, hub_mold")
      .eq("product_type", "hub")
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
    setForm((prev) => ({ ...prev, hub_number: productNumber, hub_style: product?.hub_style || prev.hub_style }))
    setError(null)
  }

  const lockingOK = ["PASS", "FAIL", "N/A"].includes(form.locking_mechanism)
  const visualOK = ["PASS", "FAIL"].includes(form.visual_inspection)
  const canSubmit = !!form.hub_number && lockingOK && visualOK && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      setError(t("quality.form.requiredFields"))
      return
    }
    const moldCavity = toIntOrNull(form.mold_cavity)
    const boreSize = toFiniteOrNull(form.bore_size)
    const boreLength = toFiniteOrNull(form.bore_length)
    const hubDiameter = toFiniteOrNull(form.hub_diameter)
    const weight = toFiniteOrNull(form.weight)
    if (!moldCavity.ok || !boreSize.ok || !boreLength.ok || !hubDiameter.ok || !weight.ok) {
      setError(t("quality.form.invalidNumber"))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/quality/inspections/hubs", {
        method: "POST",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          hub_number: form.hub_number,
          hub_style: selectedProduct?.hub_style || form.hub_style || null,
          hub_mold: selectedProduct?.hub_mold || null,
          mold_cavity: moldCavity.value,
          bore_size: boreSize.value,
          bore_size_target: selectedProduct?.bore_size_target ?? null,
          bore_length: boreLength.value,
          bore_length_target: selectedProduct?.bore_length_target ?? null,
          hub_diameter: hubDiameter.value,
          hub_diameter_target: selectedProduct?.hub_diameter_target ?? null,
          weight: weight.value,
          weight_target: selectedProduct?.weight_target ?? null,
          locking_mechanism: form.locking_mechanism,
          visual_inspection: form.visual_inspection,
          comments: form.comments,
        }),
      })
      if (res.ok) {
        router.push("/quality/hubs")
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
    <QualityFormShell title={t("quality.form.hubNew")} subtitle={t("quality.form.newInspection")} backHref="/quality/hubs" cardTitle={t("quality.form.newInspection")}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label>{t("quality.col.hubNumber")}</Label>
          <Select value={form.hub_number || undefined} onValueChange={handleProductSelect}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectHub")} /></SelectTrigger>
            <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.product_number}>{p.product_number}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("quality.col.moldCavity")}</Label>
          <Select value={form.mold_cavity || undefined} onValueChange={(v) => updateField("mold_cavity", v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectCavity")} /></SelectTrigger>
            <SelectContent>{["1", "2", "3", "4"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {selectedProduct && (
          <>
            <div className="flex flex-wrap gap-3">
              <InfoPill label={t("quality.col.hubStyle")} value={selectedProduct.hub_style} />
              <InfoPill label={t("quality.col.hubMold")} value={selectedProduct.hub_mold} />
            </div>
            <DrawingViewer partNumbers={[form.hub_number]} labels={[`${t("quality.productType.hub")} ${form.hub_number}`]} />
            <TargetPanel title={t("quality.form.target")}>
              <span>{t("quality.col.boreSize")}: {selectedProduct.bore_size_target ?? "—"}</span>
              <span>{t("quality.col.boreLength")}: {selectedProduct.bore_length_target ?? "—"}</span>
              <span>{t("quality.col.hubDiameter")}: {selectedProduct.hub_diameter_target ?? "—"}</span>
              <span>{t("quality.col.weight")}: {selectedProduct.weight_target ?? "—"}</span>
            </TargetPanel>
          </>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(["bore_size", "bore_length", "hub_diameter", "weight"] as const).map((key) => (
            <div key={key} className="space-y-2">
              <Label>{t(`quality.col.${key === "bore_size" ? "boreSize" : key === "bore_length" ? "boreLength" : key === "hub_diameter" ? "hubDiameter" : "weight"}`)}</Label>
              <Input type="number" step="0.001" inputMode="decimal" value={form[key]} onChange={(e) => updateField(key, e.target.value)} placeholder={t("quality.form.measurement")} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("quality.col.lockingMechanism")}</Label>
            <Select value={form.locking_mechanism || undefined} onValueChange={(v) => updateField("locking_mechanism", v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.select")} /></SelectTrigger>
              <SelectContent><SelectItem value="PASS">PASS</SelectItem><SelectItem value="FAIL">FAIL</SelectItem><SelectItem value="N/A">N/A</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("quality.col.visualInspection")}</Label>
            <Select value={form.visual_inspection || undefined} onValueChange={(v) => updateField("visual_inspection", v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.select")} /></SelectTrigger>
              <SelectContent><SelectItem value="PASS">PASS</SelectItem><SelectItem value="FAIL">FAIL</SelectItem></SelectContent>
            </Select>
          </div>
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
