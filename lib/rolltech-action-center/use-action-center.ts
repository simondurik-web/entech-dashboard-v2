"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import type { ActionRecord, QueueBucket, DailyDigest, WeeklyDigest } from "./types"
import { BUCKET_CONFIG } from "./types"
import { toast } from "@/lib/use-toast"

export type ViewMode = "queue" | "daily-digest" | "weekly-digest"

const VALID_BUCKETS = new Set<string>(Object.keys(BUCKET_CONFIG))
const VALID_VIEWS = new Set<string>(["queue", "daily-digest", "weekly-digest"])

const EMPTY_BUCKET_COUNTS: Record<QueueBucket, number> = {
  needs_reply_today: 0,
  needs_internal_decision: 0,
  ready_to_process: 0,
  shipping_release_coordination: 0,
  waiting_on_customer: 0,
  needs_review: 0,
  resolved: 0,
  noise: 0,
}

function parseBucketParam(v: string | null): QueueBucket | "all" {
  if (!v || v === "all") return "all"
  return VALID_BUCKETS.has(v) ? (v as QueueBucket) : "all"
}

function parseViewParam(v: string | null): ViewMode {
  if (!v) return "queue"
  return VALID_VIEWS.has(v) ? (v as ViewMode) : "queue"
}

interface ApiResponse {
  records: ActionRecord[]
  bucket_counts: Record<QueueBucket, number>
  daily_digest: DailyDigest | null
  weekly_digest: WeeklyDigest | null
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

  // Live API state
  const [records, setRecords] = useState<ActionRecord[]>([])
  const [bucketCounts, setBucketCounts] = useState<Record<QueueBucket, number>>(EMPTY_BUCKET_COUNTS)
  const [dailyDigest, setDailyDigest] = useState<DailyDigest | null>(null)
  const [weeklyDigest, setWeeklyDigest] = useState<WeeklyDigest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Thread detail state (fresh single-record fetch for selected thread)
  const [threadDetail, setThreadDetail] = useState<ActionRecord | null>(null)
  const [threadDetailLoading, setThreadDetailLoading] = useState(false)

  // Mutate state
  const mutatingRef = useRef(false)
  const [mutating, setMutating] = useState(false)
  const [lastMutateDryRun, setLastMutateDryRun] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setIsLoading(true)
      setError(null)
      try {
        const [queueRes, digestsRes] = await Promise.all([
          fetch("/api/rolltech-actions"),
          fetch("/api/rolltech-actions/digests").catch(() => null),
        ])
        if (!queueRes.ok) {
          const body = await queueRes.json().catch(() => ({}))
          throw new Error(body.error ?? `API returned ${queueRes.status}`)
        }
        const data: ApiResponse = await queueRes.json()
        if (cancelled) return
        setRecords(data.records)
        setBucketCounts(data.bucket_counts)

        // Digests from dedicated endpoint; fall back to main response (null) on failure
        let daily = data.daily_digest
        let weekly = data.weekly_digest
        if (digestsRes?.ok) {
          const digests = await digestsRes.json().catch(() => ({}))
          daily = digests.daily_digest ?? daily
          weekly = digests.weekly_digest ?? weekly
        }
        setDailyDigest(daily)
        setWeeklyDigest(weekly)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load action center")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

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

  // Fetch thread detail whenever the selected thread changes
  useEffect(() => {
    const threadKey = selectedRecord?.thread_key
    if (!threadKey) {
      setThreadDetail(null)
      return
    }
    let cancelled = false
    setThreadDetailLoading(true)
    fetch(`/api/rolltech-actions/${encodeURIComponent(threadKey)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setThreadDetail((data.record as ActionRecord) ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setThreadDetail(null)
      })
      .finally(() => {
        if (!cancelled) setThreadDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRecord?.thread_key])

  const onMutate = useCallback(
    async (actionType: string) => {
      const threadKey = selectedRecord?.thread_key
      if (!threadKey || mutatingRef.current) return
      mutatingRef.current = true
      setMutating(true)
      try {
        const res = await fetch("/api/rolltech-actions/mutate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread_key: threadKey, action_type: actionType }),
        })
        const data = await res.json()
        if (res.ok && data.ok) {
          setLastMutateDryRun(data.dry_run ?? false)
          const bucketLabel = BUCKET_CONFIG[actionType as QueueBucket]?.label ?? actionType
          toast({
            title: data.dry_run ? "Dry run: action recorded locally" : `Moved to ${bucketLabel}`,
            description: data.dry_run ? `Would move to "${bucketLabel}" — writes not yet live` : undefined,
            type: data.dry_run ? "info" : "success",
          })
          // Optimistic local update — reflect the bucket change immediately.
          setRecords((prev) =>
            prev.map((r) =>
              r.thread_key === threadKey
                ? { ...r, queue_bucket: actionType as QueueBucket }
                : r
            )
          )
          // Recompute bucket counts from updated records
          setBucketCounts((prev) => {
            const counts = { ...prev }
            const oldBucket = selectedRecord?.queue_bucket
            if (oldBucket && oldBucket in counts) counts[oldBucket]--
            const newBucket = actionType as QueueBucket
            if (newBucket in counts) counts[newBucket]++
            return counts
          })
        } else {
          toast({
            title: "Action failed",
            description: data.error ?? `Server returned ${res.status}`,
            type: "error",
          })
        }
      } catch (err) {
        toast({
          title: "Network error",
          description: "Could not reach the server. Check your connection.",
          type: "error",
        })
      } finally {
        mutatingRef.current = false
        setMutating(false)
      }
    },
    [selectedRecord?.thread_key, selectedRecord?.queue_bucket]
  )

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
    isLoading,
    error,
    threadDetail,
    threadDetailLoading,
    onMutate,
    mutating,
    lastMutateDryRun,
  }
}
