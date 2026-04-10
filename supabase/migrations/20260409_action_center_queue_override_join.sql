-- ============================================================
-- RollTech Action Center — Override Join for Queue View
-- Migration: 20260409_action_center_queue_override_join.sql
--
-- Replaces v_action_center_queue with a version that LEFT JOINs
-- the latest override per thread_key from action_center_overrides.
-- When an override exists, COALESCE replaces queue_bucket with
-- the override's action_type.
-- ============================================================

CREATE OR REPLACE VIEW work_email.v_action_center_queue AS
WITH latest_overrides AS (
  SELECT DISTINCT ON (thread_key)
    thread_key,
    action_type AS override_bucket
  FROM work_email.action_center_overrides
  ORDER BY thread_key, performed_at DESC
)
SELECT
  a.id,
  a.action_record_id,
  a.thread_key,
  a.conversation_id,
  a.latest_email_id,
  a.first_email_id,
  a.thread_subject,
  a.subject_normalized,
  a.machine_status,
  a.machine_priority,
  a.action_needed,
  COALESCE(lo.override_bucket, a.queue_bucket) AS queue_bucket,
  a.owner_hint,
  a.owner_bucket,
  a.customer_name,
  a.customer_contact_name,
  a.customer_contact_email,
  a.action_summary,
  a.last_meaningful_direction,
  a.last_meaningful_at,
  a.last_inbound_at,
  a.last_outbound_at,
  a.due_at,
  a.due_reason,
  a.stale_after_at,
  a.confidence,
  a.signals,
  a.source_email_ids,
  a.open_question,
  a.latest_inbound_snippet,
  a.latest_outbound_snippet,
  a.thread_stage,
  a.reference_numbers,
  a.has_attachments,
  a.is_noise_suppressed,
  a.rule_version,
  a.assigned_to,
  a.manual_status,
  a.manual_priority,
  a.resolution,
  a.resolution_note,
  a.resolved_at,
  a.resolved_by,
  a.promoted_at,
  a.last_promoted_at,
  a.promotion_count,
  COALESCE(a.manual_status, a.machine_status)   AS effective_status,
  COALESCE(a.manual_priority, a.machine_priority) AS effective_priority,
  (a.manual_status IS NOT NULL OR a.manual_priority IS NOT NULL OR a.assigned_to IS NOT NULL) AS has_manual_overrides
FROM work_email.actions a
LEFT JOIN latest_overrides lo ON lo.thread_key = a.thread_key
WHERE a.is_noise_suppressed = false
  AND COALESCE(a.manual_status, a.machine_status) <> 'closed'
ORDER BY
  CASE COALESCE(a.manual_priority, a.machine_priority)
    WHEN 'high'   THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low'    THEN 3
    ELSE 4
  END,
  CASE COALESCE(lo.override_bucket, a.queue_bucket)
    WHEN 'needs_reply_today'             THEN 1
    WHEN 'needs_internal_decision'       THEN 2
    WHEN 'ready_to_process'              THEN 3
    WHEN 'shipping_release_coordination' THEN 4
    WHEN 'waiting_on_customer'           THEN 5
    WHEN 'needs_review'                  THEN 6
    ELSE 7
  END,
  a.last_meaningful_at DESC;

-- Re-grant after view replace
GRANT SELECT ON work_email.v_action_center_queue TO service_role;
