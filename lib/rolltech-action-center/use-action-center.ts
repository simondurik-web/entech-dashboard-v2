"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import type { ActionRecord, QueueBucket } from "./types"
import { BUCKET_CONFIG } from "./types"
import {
  SEED_ACTION_RECORDS,
  SEED_BUCKET_COUNTS,
  SEED_DAILY_DIGEST,
  SEED_WEEKLY_DIGEST,
} from "./seed-data"

export type ViewMode = "queue" | "daily-digest" | "weekly-digest"

export function useActionCenter() {
  const [activeBucket, setActiveBucket] = useState<QueueBucket | "all">("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("queue")
  const [hasAutoSelected, setHasAutoSelected] = useState(false)

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

  useEffect(() => {
    if (viewMode !== "queue") return

    if (filteredRecords.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }

    if (!hasAutoSelected) {
      setSelectedId((current) => current ?? filteredRecords[0].action_record_id)
      setHasAutoSelected(true)
      return
    }

    if (selectedId && !filteredRecords.some((record) => record.action_record_id === selectedId)) {
      setSelectedId(filteredRecords[0].action_record_id)
    }
  }, [filteredRecords, hasAutoSelected, selectedId, viewMode])

  const selectedRecord = useMemo(
    () => (selectedId ? records.find((r) => r.action_record_id === selectedId) ?? null : null),
    [records, selectedId]
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
    selectedId,
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
