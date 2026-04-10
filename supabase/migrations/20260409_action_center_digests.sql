-- ============================================================
-- RollTech Action Center — Phase 3: Digest Views
-- Migration: 20260409_action_center_digests.sql
--
-- Two read-only views that aggregate v_action_center_queue into
-- the DailyDigest / WeeklyDigest JSON shapes expected by
-- GET /api/rolltech-actions/digests.
--
-- Limitations:
--   - Weekly throughput.newly_resolved_count and
--     throughput.new_thread_count return NULL because the
--     source view lacks first_seen_at / resolved_at columns.
--     The UI handles NULL gracefully for these fields.
--   - Both views compute a live snapshot — they do not store
--     historical digests. Each returns exactly one row.
-- ============================================================


-- ============================================================
-- Helper: build a DigestItem JSONB from a queue record
-- ============================================================
CREATE OR REPLACE FUNCTION work_email._digest_item(r work_email.v_action_center_queue)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'subject',         r.thread_subject,
    'summary',         r.action_summary,
    'priority',        r.effective_priority,
    'reference',       COALESCE(
                         r.reference_numbers->'po_numbers'->>0,
                         r.reference_numbers->'quote_numbers'->>0
                       ),
    'owner_hint',      r.owner_hint,
    'thread_key',      r.thread_key,
    'due_reason',      r.due_reason,
    'open_question',   r.open_question,
    'has_attachments', r.has_attachments,
    'confidence',      r.confidence,
    'signals',         to_jsonb(r.signals),
    'status',          r.effective_status,
    'queue_bucket',    r.queue_bucket
  )
$$;


-- ============================================================
-- v_action_center_daily_digest
-- Returns one row per current date with sections grouped by
-- queue_bucket (active records only, ordered by urgency).
-- ============================================================
CREATE OR REPLACE VIEW work_email.v_action_center_daily_digest AS
WITH
queue AS (
  SELECT * FROM work_email.v_action_center_queue
),
active AS (
  SELECT * FROM queue
  WHERE queue_bucket NOT IN ('resolved', 'noise')
    AND is_noise_suppressed IS NOT TRUE
),
suppressed AS (
  SELECT count(*)::int AS cnt FROM queue
  WHERE queue_bucket IN ('resolved', 'noise')
     OR is_noise_suppressed IS TRUE
),
bucket_sections AS (
  SELECT
    queue_bucket,
    CASE queue_bucket
      WHEN 'needs_reply_today'          THEN 'Needs Reply Today'
      WHEN 'needs_internal_decision'    THEN 'Needs Internal Decision'
      WHEN 'ready_to_process'           THEN 'Ready to Process'
      WHEN 'shipping_release_coordination' THEN 'Shipping / Release'
      WHEN 'waiting_on_customer'        THEN 'Waiting on Customer'
      WHEN 'needs_review'               THEN 'Needs Review'
      ELSE initcap(replace(queue_bucket, '_', ' '))
    END AS title,
    CASE queue_bucket
      WHEN 'needs_reply_today'          THEN 0
      WHEN 'needs_internal_decision'    THEN 1
      WHEN 'ready_to_process'           THEN 2
      WHEN 'shipping_release_coordination' THEN 3
      WHEN 'waiting_on_customer'        THEN 4
      WHEN 'needs_review'               THEN 5
      ELSE 99
    END AS sort_order,
    count(*)::int AS cnt
  FROM active
  GROUP BY queue_bucket
),
-- Build items per bucket — ordered by priority desc, then recency
bucket_items AS (
  SELECT
    a.queue_bucket,
    jsonb_agg(
      work_email._digest_item(a.*)
      ORDER BY
        CASE a.effective_priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        a.last_meaningful_at DESC NULLS LAST
    ) AS items
  FROM active a
  GROUP BY a.queue_bucket
)
SELECT
  'daily'::text                       AS digest_type,
  '1.0'::text                         AS digest_version,
  CURRENT_DATE::text                  AS digest_date,
  now()::text                         AS generated_at,
  (SELECT count(*)::int FROM active)  AS total_active,
  (SELECT cnt FROM suppressed)        AS total_suppressed,
  (SELECT count(*)::int FROM active)  AS total_items_surfaced,
  COALESCE(
    (SELECT jsonb_agg(
       jsonb_build_object(
         'title', bs.title,
         'count', bs.cnt,
         'items', COALESCE(bi.items, '[]'::jsonb)
       )
       ORDER BY bs.sort_order
     )
     FROM bucket_sections bs
     LEFT JOIN bucket_items bi USING (queue_bucket)
    ),
    '[]'::jsonb
  ) AS sections;


-- ============================================================
-- v_action_center_weekly_digest
-- Returns one row per current week-ending date with the full
-- WeeklyDigest structure.
-- ============================================================
CREATE OR REPLACE VIEW work_email.v_action_center_weekly_digest AS
WITH
queue AS (
  SELECT * FROM work_email.v_action_center_queue
),
-- Counts
counts AS (
  SELECT
    count(*)::int AS total_records,
    count(*) FILTER (
      WHERE queue_bucket NOT IN ('resolved', 'noise')
        AND is_noise_suppressed IS NOT TRUE
    )::int AS total_active,
    count(*) FILTER (
      WHERE queue_bucket IN ('resolved', 'noise')
         OR is_noise_suppressed IS TRUE
    )::int AS total_suppressed
  FROM queue
),
-- At-risk: high priority active, or past due/stale
at_risk_records AS (
  SELECT * FROM queue
  WHERE queue_bucket NOT IN ('resolved', 'noise')
    AND is_noise_suppressed IS NOT TRUE
    AND (
      effective_priority = 'high'
      OR (due_at IS NOT NULL AND due_at::timestamptz < now())
      OR (stale_after_at IS NOT NULL AND stale_after_at::timestamptz < now())
    )
),
at_risk AS (
  SELECT
    count(*)::int AS cnt,
    COALESCE(jsonb_agg(work_email._digest_item(r.*)), '[]'::jsonb) AS items
  FROM at_risk_records r
),
-- New business: RFQ or PO-received stage threads
rfq_items AS (
  SELECT work_email._digest_item(q.*) AS item
  FROM queue q
  WHERE q.thread_stage = 'rfq'
    AND q.queue_bucket NOT IN ('resolved', 'noise')
),
order_items AS (
  SELECT work_email._digest_item(q.*) AS item
  FROM queue q
  WHERE q.thread_stage = 'po_received'
    AND q.queue_bucket NOT IN ('resolved', 'noise')
),
active_accounts AS (
  SELECT DISTINCT customer_name
  FROM queue
  WHERE customer_name IS NOT NULL
    AND thread_stage IN ('rfq', 'po_received')
    AND queue_bucket NOT IN ('resolved', 'noise')
),
new_business AS (
  SELECT jsonb_build_object(
    'rfq_threads',       COALESCE((SELECT jsonb_agg(item) FROM rfq_items), '[]'::jsonb),
    'order_threads',     COALESCE((SELECT jsonb_agg(item) FROM order_items), '[]'::jsonb),
    'active_accounts',   COALESCE(
                           (SELECT jsonb_agg(customer_name) FROM active_accounts),
                           '[]'::jsonb
                         ),
    'total_new_business', (SELECT count(*) FROM rfq_items) + (SELECT count(*) FROM order_items)
  ) AS obj
),
-- Open commitments: active records grouped by bucket
commitment_buckets AS (
  SELECT
    queue_bucket,
    jsonb_agg(
      work_email._digest_item(q.*)
      ORDER BY
        CASE q.effective_priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        q.last_meaningful_at DESC NULLS LAST
    ) AS items
  FROM queue q
  WHERE queue_bucket NOT IN ('resolved', 'noise')
    AND is_noise_suppressed IS NOT TRUE
  GROUP BY queue_bucket
),
open_commitments AS (
  SELECT jsonb_build_object(
    'total',   (SELECT total_active FROM counts),
    'buckets', COALESCE(
                 (SELECT jsonb_object_agg(queue_bucket, items) FROM commitment_buckets),
                 '{}'::jsonb
               )
  ) AS obj
),
-- Throughput
resolved_records AS (
  SELECT * FROM queue WHERE queue_bucket = 'resolved'
),
throughput AS (
  SELECT jsonb_build_object(
    'resolved_count',        (SELECT count(*)::int FROM resolved_records),
    'active_count',          (SELECT total_active FROM counts),
    'newly_resolved_count',  NULL,  -- requires resolved_at timestamp, not available
    'new_thread_count',      NULL,  -- requires first_seen_at timestamp, not available
    'resolved_threads',      COALESCE(
                               (SELECT jsonb_agg(work_email._digest_item(r.*)) FROM resolved_records r),
                               '[]'::jsonb
                             ),
    'newly_resolved_threads', '[]'::jsonb  -- no temporal data to filter on
  ) AS obj
),
-- Noise report
noise_records AS (
  SELECT * FROM queue
  WHERE queue_bucket = 'noise' OR is_noise_suppressed IS TRUE
),
noise_only AS (
  SELECT * FROM queue WHERE queue_bucket = 'noise'
),
resolved_only AS (
  SELECT * FROM queue WHERE queue_bucket = 'resolved'
),
noise_report AS (
  SELECT jsonb_build_object(
    'total_suppressed',  (SELECT total_suppressed FROM counts),
    'noise_count',       (SELECT count(*)::int FROM noise_only),
    'resolved_count',    (SELECT count(*)::int FROM resolved_only),
    'suppression_rate',  CASE
                           WHEN (SELECT total_records FROM counts) > 0
                           THEN round(
                             (SELECT total_suppressed FROM counts)::numeric
                             / (SELECT total_records FROM counts)::numeric, 3
                           )
                           ELSE 0
                         END,
    'noise_threads',     COALESCE(
                           (SELECT jsonb_agg(work_email._digest_item(n.*)) FROM noise_only n),
                           '[]'::jsonb
                         ),
    'resolved_threads',  COALESCE(
                           (SELECT jsonb_agg(work_email._digest_item(r.*)) FROM resolved_only r),
                           '[]'::jsonb
                         )
  ) AS obj
)
SELECT
  'weekly'::text                                            AS digest_type,
  '1.0'::text                                              AS digest_version,
  -- week_ending = next Sunday (or today if Sunday)
  (CURRENT_DATE + (7 - extract(dow FROM CURRENT_DATE)::int) % 7)::text AS week_ending,
  now()::text                                               AS generated_at,
  (SELECT total_records FROM counts)                        AS total_records,
  (SELECT total_active FROM counts)                         AS total_active,
  (SELECT total_suppressed FROM counts)                     AS total_suppressed,
  (SELECT obj FROM open_commitments)                        AS open_commitments,
  jsonb_build_object(
    'count', (SELECT cnt FROM at_risk),
    'items', (SELECT items FROM at_risk)
  )                                                         AS at_risk,
  (SELECT obj FROM new_business)                            AS new_business,
  (SELECT obj FROM throughput)                              AS throughput,
  (SELECT obj FROM noise_report)                            AS noise_report;
