"use client"

import { useEffect, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { userHeaders } from "@/lib/quality/form-utils"

export interface QualityEditFieldDef {
  key: string
  label: string
  type: "text" | "number" | "select"
  options?: string[]
  readOnly?: boolean
}

interface EditInspectionModalProps {
  record: Record<string, unknown> | null
  fields: QualityEditFieldDef[]
  apiEndpoint: string
  onClose: () => void
  onSaved: (updated: Record<string, unknown>) => void
}

function numberValue(raw: string): number | null {
  if (raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function EditInspectionModal({
  record,
  fields,
  apiEndpoint,
  onClose,
  onSaved,
}: EditInspectionModalProps) {
  const { profile } = useAuth()
  const { t } = useI18n()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (record) setValues({ ...record })
    else setValues({})
    setError(null)
  }, [record])

  async function handleSave() {
    if (!record) return
    setSaving(true)
    setError(null)
    try {
      const payload = Object.fromEntries(
        fields.filter((f) => !f.readOnly).map((f) => [f.key, values[f.key] ?? null]),
      )
      const res = await fetch(apiEndpoint, {
        method: "PUT",
        headers: userHeaders(profile?.id),
        body: JSON.stringify({ id: record.id, ...payload }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || t("quality.edit.saveError"))
      }
      const { data } = await res.json()
      onSaved(data)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("quality.edit.saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!record} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("quality.edit.title")} #{record?.id != null ? String(record.id) : ""}</DialogTitle>
          <DialogDescription>{t("quality.edit.subtitle")}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{field.label}</Label>
              {field.type === "select" ? (
                <Select
                  value={values[field.key] == null || values[field.key] === "" ? undefined : String(values[field.key])}
                  onValueChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                  disabled={field.readOnly || saving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="-" />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field.type}
                  step={field.type === "number" ? "0.001" : undefined}
                  inputMode={field.type === "number" ? "decimal" : undefined}
                  value={values[field.key] == null ? "" : String(values[field.key])}
                  onChange={(e) => {
                    const value = field.type === "number" ? numberValue(e.target.value) : e.target.value
                    setValues((prev) => ({ ...prev, [field.key]: value }))
                  }}
                  readOnly={field.readOnly}
                  disabled={saving}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("quality.edit.cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !record}>
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            {t("quality.edit.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
