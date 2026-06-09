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
  description: string | null
  thickness_target: number | null
  diameter_target: number | null
  weight_target: number | null
}

type FormState = {
  rt_number: string
  correct_tire: string
  correct_hub: string
  correct_hub_color: string
  tire_od: string
  tire_thickness: string
  tire_weight: string
  bore_check: string
  locking_mechanism: string
  tire_visual: string
  hub_visual: string
  comments: string
}

const PASS_FAIL_FIELDS: (keyof FormState)[] = ["correct_tire", "correct_hub", "correct_hub_color", "bore_check", "locking_mechanism", "tire_visual", "hub_visual"]

function PassFailSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.select")} /></SelectTrigger>
        <SelectContent><SelectItem value="PASS">PASS</SelectItem><SelectItem value="FAIL">FAIL</SelectItem></SelectContent>
      </Select>
    </div>
  )
}

export default function NewFinishedInspectionPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canSeeQuality } = useQualityAccess()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({
    rt_number: "",
    correct_tire: "",
    correct_hub: "",
    correct_hub_color: "",
    tire_od: "",
    tire_thickness: "",
    tire_weight: "",
    bore_check: "",
    locking_mechanism: "",
    tire_visual: "",
    hub_visual: "",
    comments: "",
  })

  useEffect(() => {
    if (!canSeeQuality) return
    let alive = true
    supabase
      .from("qa_products")
      .select("id, product_number, description, thickness_target, diameter_target, weight_target")
      .eq("product_type", "finished_product")
      .order("product_number")
      .then(({ data }) => { if (alive) setProducts((data || []) as Product[]) })
    return () => { alive = false }
  }, [canSeeQuality])

  if (!canSeeQuality) return null

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  function handleProductSelect(productNumber: string) {
    const product = products.find((p) => p.product_number === productNumber) || null
    setSelectedProduct(product)
    updateField("rt_number", productNumber)
  }

  const allPassFailComplete = PASS_FAIL_FIELDS.every((k) => ["PASS", "FAIL"].includes(form[k]))
  const canSubmit = !!form.rt_number && allPassFailComplete && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      setError(t("quality.form.requiredFields"))
      return
    }
    const od = toFiniteOrNull(form.tire_od)
    const thickness = toFiniteOrNull(form.tire_thickness)
    const weight = toFiniteOrNull(form.tire_weight)
    if (!od.ok || !thickness.ok || !weight.ok) {
      setError(t("quality.form.invalidNumber"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/quality/inspections/finished", {
        method: "POST",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          rt_number: form.rt_number,
          correct_tire: form.correct_tire,
          correct_hub: form.correct_hub,
          correct_hub_color: form.correct_hub_color,
          tire_od: od.value,
          tire_thickness: thickness.value,
          tire_weight: weight.value,
          bore_check: form.bore_check,
          locking_mechanism: form.locking_mechanism,
          tire_visual: form.tire_visual,
          hub_visual: form.hub_visual,
          comments: form.comments,
        }),
      })
      if (res.ok) {
        router.push("/quality/finished")
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
    <QualityFormShell title={t("quality.form.finishedNew")} subtitle={t("quality.form.finishedSubtitle")} backHref="/quality/finished" cardTitle={t("quality.form.newInspection")}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label>{t("quality.col.rtNumber")}</Label>
          {manualEntry ? (
            <div className="flex gap-2">
              <Input value={form.rt_number} onChange={(e) => updateField("rt_number", e.target.value)} placeholder={t("quality.form.typeRtManually")} autoFocus />
              <Button type="button" variant="outline" onClick={() => { setManualEntry(false); updateField("rt_number", "") }}>{t("quality.form.backToList")}</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select value={form.rt_number || undefined} onValueChange={handleProductSelect}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("quality.form.selectFinished")} /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.product_number}>{p.description ? `${p.product_number} - ${p.description}` : p.product_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={() => { setManualEntry(true); setSelectedProduct(null); updateField("rt_number", "") }}>{t("quality.form.manual")}</Button>
            </div>
          )}
        </div>

        {selectedProduct && (
          <TargetPanel title={t("quality.form.target")}>
            <span>{t("quality.col.diameter")}: {selectedProduct.diameter_target ?? "—"}</span>
            <span>{t("quality.col.thickness")}: {selectedProduct.thickness_target ?? "—"}</span>
            <span>{t("quality.col.weight")}: {selectedProduct.weight_target ?? "—"}</span>
          </TargetPanel>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PassFailSelect label={t("quality.col.correctTire")} value={form.correct_tire} onChange={(v) => updateField("correct_tire", v)} />
          <PassFailSelect label={t("quality.col.correctHub")} value={form.correct_hub} onChange={(v) => updateField("correct_hub", v)} />
          <PassFailSelect label={t("quality.col.correctHubColor")} value={form.correct_hub_color} onChange={(v) => updateField("correct_hub_color", v)} />
          <PassFailSelect label={t("quality.col.boreCheck")} value={form.bore_check} onChange={(v) => updateField("bore_check", v)} />
          <PassFailSelect label={t("quality.col.lockingMechanism")} value={form.locking_mechanism} onChange={(v) => updateField("locking_mechanism", v)} />
          <PassFailSelect label={t("quality.col.tireVisual")} value={form.tire_visual} onChange={(v) => updateField("tire_visual", v)} />
          <PassFailSelect label={t("quality.col.hubVisual")} value={form.hub_visual} onChange={(v) => updateField("hub_visual", v)} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("quality.col.tireOd")}</Label>
            <Input type="number" step="0.001" inputMode="decimal" value={form.tire_od} onChange={(e) => updateField("tire_od", e.target.value)} placeholder={t("quality.form.measurement")} />
          </div>
          <div className="space-y-2">
            <Label>{t("quality.col.tireThickness")}</Label>
            <Input type="number" step="0.001" inputMode="decimal" value={form.tire_thickness} onChange={(e) => updateField("tire_thickness", e.target.value)} placeholder={t("quality.form.measurement")} />
          </div>
          <div className="space-y-2">
            <Label>{t("quality.col.tireWeight")}</Label>
            <Input type="number" step="0.001" inputMode="decimal" value={form.tire_weight} onChange={(e) => updateField("tire_weight", e.target.value)} placeholder={t("quality.form.measurement")} />
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
