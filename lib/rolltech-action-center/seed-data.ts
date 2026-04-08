import seedJson from "./seed-data.json"
import type { ActionRecord, DailyDigest, WeeklyDigest, QueueBucket } from "./types"

const data = seedJson as {
  bucket_counts: Record<string, number>
  records: ActionRecord[]
  daily_digest: DailyDigest
  weekly_digest: WeeklyDigest
}

/** Full bucket counts from the complete 328-record dataset */
export const SEED_BUCKET_COUNTS: Record<QueueBucket, number> = {
  needs_reply_today: data.bucket_counts.needs_reply_today ?? 0,
  needs_internal_decision: data.bucket_counts.needs_internal_decision ?? 0,
  ready_to_process: data.bucket_counts.ready_to_process ?? 0,
  shipping_release_coordination: data.bucket_counts.shipping_release_coordination ?? 0,
  waiting_on_customer: data.bucket_counts.waiting_on_customer ?? 0,
  needs_review: data.bucket_counts.needs_review ?? 0,
  resolved: data.bucket_counts.resolved ?? 0,
  noise: data.bucket_counts.noise ?? 0,
}

/** Representative sample: ~5 records per bucket */
export const SEED_ACTION_RECORDS: ActionRecord[] = data.records

/** Daily digest preview */
export const SEED_DAILY_DIGEST: DailyDigest = data.daily_digest

/** Weekly digest preview */
export const SEED_WEEKLY_DIGEST: WeeklyDigest = data.weekly_digest
