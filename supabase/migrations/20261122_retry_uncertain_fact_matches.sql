-- Re-evaluate previously held matches with publication-first matching.
-- Never restore dismissed, reserved, used or manually excluded evidence.
update source_candidates
set processing_status = 'pending', next_retry_at = now()
where processing_status = 'ready' and status = 'available'
  and allow_auto_publish and event_id is null and reserved_by is null
  and review_reason like 'Uncertain event match:%';
