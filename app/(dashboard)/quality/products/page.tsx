"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useQualityAccess } from "@/lib/use-quality-access"
import { userHeaders } from "@/lib/quality/form-utils"
import type { ProductType } from "@/lib/quality/metrics"

type Product = {
  id: number
  product_type: ProductType
  product_number: string
  description: string | null
  bore_size_target: number | null
  bore_length_target: number | null
  hub_diameter_target: number | null
  weight_target: number | null
  thickness_target: number | null
  diameter_target: number | null
  specs_json: Record<string, unknown> | null
}

const emptyForm = {
  product_type: "hub" as ProductType,
  product_number: "",
  description: "",
  bore_size_target: "",
  bore_length_target: "",
  hub_diameter_target: "",
  weight_target: "",
  thickness_target: "",
  diameter_target: "",
}

function parseTarget(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export default function QualityProductsPage() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canManageQuality } = useQualityAccess()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/quality/products", { headers: userHeaders(profile?.id) })
      const json = await res.json()
      setProducts(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (canManageQuality) loadProducts()
  }, [canManageQuality, loadProducts])

  if (!canManageQuality) return null

  function openAddDialog(type: ProductType) {
    setEditingId(null)
    setForm({ ...emptyForm, product_type: type })
    setError(null)
    setDialogOpen(true)
  }

  function openEditDialog(product: Product) {
    setEditingId(product.id)
    setForm({
      product_type: product.product_type,
      product_number: product.product_number,
      description: product.description || "",
      bore_size_target: product.bore_size_target?.toString() || "",
      bore_length_target: product.bore_length_target?.toString() || "",
      hub_diameter_target: product.hub_diameter_target?.toString() || "",
      weight_target: product.weight_target?.toString() || "",
      thickness_target: product.thickness_target?.toString() || "",
      diameter_target: product.diameter_target?.toString() || "",
    })
    setError(null)
    setDialogOpen(true)
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.product_number.trim()) return
    setSubmitting(true)
    setError(null)
    const payload = {
      product_type: form.product_type,
      product_number: form.product_number,
      description: form.description || null,
      bore_size_target: parseTarget(form.bore_size_target),
      bore_length_target: parseTarget(form.bore_length_target),
      hub_diameter_target: parseTarget(form.hub_diameter_target),
      weight_target: parseTarget(form.weight_target),
      thickness_target: parseTarget(form.thickness_target),
      diameter_target: parseTarget(form.diameter_target),
    }
    try {
      const res = await fetch("/api/quality/products", {
        method: editingId ? "PUT" : "POST",
        headers: userHeaders(profile?.id),
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || t("quality.form.networkError"))
        return
      }
      setDialogOpen(false)
      await loadProducts()
    } finally {
      setSubmitting(false)
    }
  }

  function ProductTable({ type }: { type: ProductType }) {
    const filtered = products.filter((p) => p.product_type === type)
    const isHub = type === "hub"
    const isTire = type === "tire"
    return (
      <div className="pt-4">
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => openAddDialog(type)}><Plus className="mr-2 size-3.5" />{t("quality.admin.addProduct")}</Button>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{loading ? t("quality.admin.loading") : t("quality.admin.noProducts")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("quality.admin.productNumber")}</TableHead>
                <TableHead>{t("quality.admin.description")}</TableHead>
                {isHub && <><TableHead>{t("quality.col.boreSize")}</TableHead><TableHead>{t("quality.col.boreLength")}</TableHead><TableHead>{t("quality.col.hubDiameter")}</TableHead></>}
                {isTire && <><TableHead>{t("quality.col.thickness")}</TableHead><TableHead>{t("quality.col.diameter")}</TableHead></>}
                <TableHead>{t("quality.col.weight")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-mono font-medium">{product.product_number}</TableCell>
                  <TableCell>{product.description || "—"}</TableCell>
                  {isHub && <><TableCell>{product.bore_size_target ?? "—"}</TableCell><TableCell>{product.bore_length_target ?? "—"}</TableCell><TableCell>{product.hub_diameter_target ?? "—"}</TableCell></>}
                  {isTire && <><TableCell>{product.thickness_target ?? "—"}</TableCell><TableCell>{product.diameter_target ?? "—"}</TableCell></>}
                  <TableCell>{product.weight_target ?? "—"}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}><Pencil className="size-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="mb-1 text-2xl font-bold">{t("nav.qualityProducts")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("quality.admin.productsSubtitle")}</p>
      <div className="rounded-lg border border-border bg-card p-4">
        <Tabs defaultValue="hub">
          <TabsList>
            <TabsTrigger value="hub">{t("quality.productType.hub")}</TabsTrigger>
            <TabsTrigger value="tire">{t("quality.productType.tire")}</TabsTrigger>
            <TabsTrigger value="finished_product">{t("quality.productType.finished")}</TabsTrigger>
          </TabsList>
          <TabsContent value="hub"><ProductTable type="hub" /></TabsContent>
          <TabsContent value="tire"><ProductTable type="tire" /></TabsContent>
          <TabsContent value="finished_product"><ProductTable type="finished_product" /></TabsContent>
        </Tabs>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? t("quality.admin.editProduct") : t("quality.admin.addProduct")}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editingId && (
              <div className="space-y-2">
                <Label>{t("quality.col.productType")}</Label>
                <Select value={form.product_type} onValueChange={(v) => updateField("product_type", v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="hub">{t("quality.productType.hub")}</SelectItem><SelectItem value="tire">{t("quality.productType.tire")}</SelectItem><SelectItem value="finished_product">{t("quality.productType.finished")}</SelectItem></SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2"><Label>{t("quality.admin.productNumber")}</Label><Input value={form.product_number} onChange={(e) => updateField("product_number", e.target.value)} placeholder="HUB-001" /></div>
            <div className="space-y-2"><Label>{t("quality.admin.description")}</Label><Input value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder={t("quality.admin.descriptionPlaceholder")} /></div>
            {(form.product_type === "hub" || form.product_type === "finished_product") && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>{t("quality.admin.boreSizeTarget")}</Label><Input type="number" step="0.001" value={form.bore_size_target} onChange={(e) => updateField("bore_size_target", e.target.value)} /></div>
                <div className="space-y-2"><Label>{t("quality.admin.boreLengthTarget")}</Label><Input type="number" step="0.001" value={form.bore_length_target} onChange={(e) => updateField("bore_length_target", e.target.value)} /></div>
                <div className="space-y-2"><Label>{t("quality.admin.hubDiameterTarget")}</Label><Input type="number" step="0.001" value={form.hub_diameter_target} onChange={(e) => updateField("hub_diameter_target", e.target.value)} /></div>
              </div>
            )}
            {(form.product_type === "tire" || form.product_type === "finished_product") && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>{t("quality.admin.thicknessTarget")}</Label><Input type="number" step="0.001" value={form.thickness_target} onChange={(e) => updateField("thickness_target", e.target.value)} /></div>
                <div className="space-y-2"><Label>{t("quality.admin.diameterTarget")}</Label><Input type="number" step="0.001" value={form.diameter_target} onChange={(e) => updateField("diameter_target", e.target.value)} /></div>
              </div>
            )}
            <div className="space-y-2"><Label>{t("quality.admin.weightTarget")}</Label><Input type="number" step="0.001" value={form.weight_target} onChange={(e) => updateField("weight_target", e.target.value)} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={!form.product_number || submitting} className="w-full">{submitting ? t("quality.admin.saving") : editingId ? t("quality.admin.updateProduct") : t("quality.admin.addProduct")}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
