"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import type { QueueBucket } from "./types"
import { BUCKET_CONFIG } from "./types"
import {
  SEED_ACTION_RECORDS,
  SEED_BUCKET_COUNTS,
  SEED_DAILY_DIGEST,
  SEED_WEEKLY_DIGEST,
} from "./seed-data"

export type ViewMode = "queue" | "daily-digest" | "weekly-digest"

const VALID_BUCKETS = new Set<string>(Object.keys(BUCKET_CONFIG))
const VALID_VIEWS = new Set<string>(["queue", "daily-digest", "weekly-digest"])

function parseBucketParam(v: string | null): QueueBucket | "all" {
  if (!v || v === "all") return "all"
  return VALID_BUCKETS.has(v) ? (v as QueueBucket) : "all"
}

function parseViewParam(v: string | null): ViewMode {
  if (!v) return "queue"
  return VALID_VIEWS.has(v) ? (v as ViewMode) : "queue"
}

export function useActionCenter() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const isInitialMount = useRef(true)

  // Read initial state from URL
  const [activeBucket, setActiveBucket] = useState<QueueBucket | "all">(() => parseBucketParam(searchParams.get("bucket")))
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("selected"))
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>(() => parseViewParam(searchParams.get("view")))

  // Use seed data — will be replaced by API fetch later
  const records = SEED_ACTION_RECORDS
  const bucketCounts = SEED_BUCKET_COUNTS
  const dailyDigest = SEED_DAILY_DIGEST
  const weeklyDigest = SEED_WEEKLY_DIGEST

  const filteredRecords = useMemo(() => {
    let result = records

    if (activeBucket !== "all") {
      result = result.filter((r) => r.queue_bucket === activeBucket)
    } else {
      result = result.filter((r) => !r.is_noise_suppressed)
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(
        (r) =>
          r.thread_subject.toLowerCase().includes(q) ||
          r.subject_normalized.includes(q) ||
          r.action_summary.toLowerCase().includes(q) ||
          (r.owner_hint?.toLowerCase().includes(q) ?? false) ||
          (r.customer_name?.toLowerCase().includes(q) ?? false) ||
          r.reference_numbers.po_numbers.some((p) => p.toLowerCase().includes(q)) ||
          r.reference_numbers.part_numbers.some((p) => p.toLowerCase().includes(q)) ||
          r.reference_numbers.quote_numbers.some((p) => p.toLowerCase().includes(q)) ||
          r.reference_numbers.tracking_numbers.some((p) => p.toLowerCase().includes(q))
      )
    }

    result = [...result].sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 }
      const pDiff = pOrder[a.priority] - pOrder[b.priority]
      if (pDiff !== 0) return pDiff
      const aDate = a.last_meaningful_at ?? ""
      const bDate = b.last_meaningful_at ?? ""
      return bDate.localeCompare(aDate)
    })

    return result
  }, [records, activeBucket, search])

  // Derive effective selection: auto-select first item when nothing valid is selected
  const effectiveSelectedId = useMemo(() => {
    if (viewMode !== "queue") return selectedId
    if (filteredRecords.length === 0) return null
    if (selectedId && filteredRecords.some((r) => r.action_record_id === selectedId)) return selectedId
    return filteredRecords[0].action_record_id
  }, [viewMode, selectedId, filteredRecords])

  const selectedRecord = useMemo(
    () => (effectiveSelectedId ? records.find((r) => r.action_record_id === effectiveSelectedId) ?? null : null),
    [records, effectiveSelectedId]
  )

  const activeCount = useMemo(
    () => records.filter((r) => !r.is_noise_suppressed).length,
    [records]
  )

  const sortedBuckets = useMemo(() => {
    return (Object.keys(BUCKET_CONFIG) as QueueBucket[]).sort(
      (a, b) => BUCKET_CONFIG[a].order - BUCKET_CONFIG[b].order
    )
  }, [])

  const handleSelectRecord = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }, [])

  return {
    activeBucket,
    setActiveBucket,
    selectedId: effectiveSelectedId,
    selectedRecord,
    handleSelectRecord,
    search,
    setSearch,
    viewMode,
    setViewMode,
    filteredRecords,
    bucketCounts,
    sortedBuckets,
    activeCount,
    dailyDigest,
    weeklyDigest,
  }
}
