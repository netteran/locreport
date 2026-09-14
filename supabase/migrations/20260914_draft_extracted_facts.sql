-- Store the Stage 1 extractor output on the draft so a re-run can re-profile the
-- Stage 2 write-up without re-deriving (and drifting) the facts.
alter table drafts
  add column if not exists extracted_facts text;

comment on column drafts.extracted_facts is
  'Raw Stage 1 fact sheet (DEFAULT_EXTRACTOR_PROMPT output). Reused verbatim by /api/drafts/[id]/rerun so re-runs only re-profile the prose. Null on drafts created before this column, or created outside the ingest pipeline — the first re-run backfills it.';
