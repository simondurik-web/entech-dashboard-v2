"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function QualityFormShell({
  title,
  subtitle,
  backHref,
  cardTitle,
  children,
}: {
  title: string
  subtitle: string
  backHref: string
  cardTitle: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl p-4 pb-20">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={backHref} aria-label={subtitle}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>{cardTitle}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

export function FieldError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </div>
  )
}

export function TargetPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/35 p-4 text-sm">
      <p className="mb-2 font-medium text-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-2 text-muted-foreground sm:grid-cols-2">{children}</div>
    </div>
  )
}

export function InfoPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 px-4 py-2 text-sm">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <p className="font-semibold text-blue-600 dark:text-blue-400">{value}</p>
    </div>
  )
}
