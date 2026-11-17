# Research candidates, event news and manual analysis

## Editorial workflow

- The existing **10:00 / 13:00 / 17:00 Europe/Warsaw weekday** workflow still collects RSS and generated feeds. It now stores the original title, resolved source URL, publisher, publication date and Stage 1 fact sheet in **Source candidates**, without writing an individual article.
- Podcast `Collect` is independent of source trust. It extracts episode notes after the configured baseline and stores candidates. Existing explicit manual podcast writing remains available.
- The existing source **Auto** flag is now **Auto facts**: eligible, recent event news may publish automatically to Fact Flow from that source. This flag never authorizes full-article generation or publication. Existing trust choices are preserved.
- Untrusted-source headlines stay pending in **Admin → Fact Flow**. Review against the source, edit, publish, reject or withdraw. Missing dates, old events, ambiguous matches and conflicting evidence cannot cause automatic publication.
- **Admin → Source candidates** offers manual selection of 1–8 sources, saved article suggestions, resumable compositions, and event review/merge. Sources remain available for analysis even when their news fact has already published.
- Select one source and choose **Create article**, or choose **Combine selected** for multiple sources. Adjust the selected evidence and its order, write a central question/direction, optionally supply personal experience, and choose a soft length target (default 1,400). A focused article from one source can be shorter; do not pad limited evidence to reach the target. Save the brief or explicitly **Generate draft**. Generation always creates a private pending draft; **Approve & publish** is a separate authenticated action.
- Evidence snapshots, the brief, personal experience and source relationships are saved. A regeneration uses the same synthesis rules and evidence. Editing source membership requires regeneration before publication. A source reservation is released on abandonment, or marked used when its composition publishes. Choose **Reuse in another article** to make used evidence selectable again; its previous source relationships remain intact.
- The generator cites selected original URLs and cannot invent a personal experience from an angle alone. Review claims, attribution and your experience before publishing. The classifier sees the longer article instead of only its first 4,000 characters.

## Event identity and Fact Flow

Source URL deduplication prevents ingesting the same page twice. Event matching separately compares named parties, action, transaction stage, supported dates and semantic evidence. Known corporate suffixes/aliases are normalized. Recent legacy published headlines without event IDs are also checked by named parties; a confirmed match adopts the existing fact and preserves its original publication time. An announcement and a later completion are distinct developments; another article repeating the announcement is evidence for the same event.

The model classifies matches as same event, conflicting evidence, different event or uncertain. Only same-event or conflict classifications with at least 90% confidence attach to an existing event. Uncertain matches and lower-confidence classifications proceed as new events and follow the usual automatic publication gates; uncertainty about duplication alone does not hold a qualifying fact. Exact event identities still reuse the existing event. This favors publication and can produce semantic duplicates, which can be merged after review. Semantic matching has a short global processing lease; a unique event identity and a unique fact/event relationship protect writes and retries. No automatic classifier can guarantee perfect semantic decisions: review held matches and use **Event review → Merge events** for remaining duplicates. A merge retains supporting sources and analysis links, withdraws the duplicate fact, and leaves its existing RSS identifier untouched.

Fact publication is explicit (`status`, `published_at`) and independent of `article_id`. Public database reads only expose published facts. Original reporting is always linked; supporting sources are available on the Fact Flow entry. Sharing and RSS use `/fact-flow#<fact-id>`. Published analyses are additional links. Linking evidence or an analysis does not rewrite a public fact or change its original publication time. Conflicting sources are excluded from supporting evidence until reviewed. Deleting an analysis removes its links and preserves independently published facts.

Candidate matching failures back off three hours and remain visible in the candidate inbox. The next scheduled run retries eligible work. Article-generation failures retain source reservations and the brief; a new manual generation retries them. Generation requests have identifiers, a lease, and a unique composition/draft relationship; article publication locks the draft and returns the existing article on retries.

Suggestions use the last 30 days of available candidates (at most 60 in one refresh), semantic neighbors and an editorial grouping pass. A shared broad tag is insufficient: a suggestion must support one useful question. Suggestions are not full drafts. Scheduled jobs have no permission to call the article generator or publish main articles. The monthly-report endpoint also requires an editor session and saves a pending draft.

Single-source articles use the same saved brief, optional personal experience, evidence snapshot, source reservation and manual publication flow. They must cite their selected source and cannot imply corroboration from other publishers. Multi-source articles must cite at least two distinct selected URLs. Suggestions continue to identify useful multi-source groups; a single source can be selected directly without a suggestion.

## Manual ingestion

Dashboard **Run ingest**, RSS source/batch **Ingest**, and podcast source **Ingest** now finish collection by processing pending evidence, matching events, creating facts and publishing eligible facts only for sources with **Auto** enabled, then refreshing article suggestions. Individual-source and batch runs process pending evidence from those sources; suggestion grouping can draw on all ready sources. Main articles still require explicit generation and approval.

Keep the admin page open until the stages finish. Each matching batch and the suggestion refresh use separate requests so they retain their own function time budgets. Even a run with zero fresh sources finishes previously saved work. **Source candidates → Process facts and suggestions** resumes existing candidates without fetching sources or repeating evidence extraction. **Suggested articles → Refresh suggestions** also processes pending evidence before grouping it.

Manual processing stops after 20 batches (up to 120 candidates) or when another run holds the event lock. Remaining work is reported explicitly and can be resumed with **Process facts and suggestions**. Candidate failures retain the existing three-hour retry delay. Collection, matching and suggestion errors are shown separately; a collected candidate does not imply that a fact was published or an article suggestion could be formed. Incomplete evidence, non-news items, confirmed conflicts and non-Auto sources retain the existing review rules. Uncertain event matching alone does not block publication.

## Deploying this PR

1. Back up the production database. Pause the Ingest workflow while applying this schema/application change together; the old application interprets `Auto` as full-article publication.
2. Apply `supabase/migrations/20261113_research_publications.sql` with the normal Supabase migration process **before enabling the new research and publishing workflow**. Preview builds can run before migration: public Fact Flow, its RSS feed and the homepage read the old article-linked facts schema. Research processing, generation and publication return a migration-required 503 until the new schema is present. It assumes the existing repository migrations and production base tables are present. Do not run it twice as raw SQL; use migration tracking.
3. The migration preserves published facts and their original dates. Existing unpublished drafts with saved fact sheets become source candidates; the old prose stays in the database as research-only and cannot be accidentally published. These imported candidates explicitly cannot auto-publish old backlog facts. Old parked facts for imported drafts are rejected in favor of event-based review. Drafts without saved evidence remain in Drafts.
   Apply `supabase/migrations/20261114_single_source_articles.sql` after the research-publications migration to enable single-source creation and replacement. It replaces the reservation functions in place without changing saved compositions or evidence. Until it is applied, single-source requests return a migration-required 503; multi-source articles continue to work.
4. Deploy the application, check **Source candidates**, **Fact Flow**, source **Auto facts**, and podcast **Collect** choices. Use a manual Ingest workflow dispatch to verify collection, held events, trusted facts and article suggestions. No historical event extraction or new article generation happens during the migration itself.
5. Re-enable the unchanged weekday schedule. Observe per-run errors and held matches. Compose an article manually and verify its source links, pending state and final Fact Flow analysis links.

Rollback is to stop scheduled ingestion and keep the schema/data in place while reverting the application as needed. Disable all legacy `auto_publish` flags before running the old application: its meaning was different. Never drop research tables to roll back; they hold the user's saved evidence and unpublished work. This PR does not apply production migrations, deploy, merge the PR, send a newsletter or post to X.

## Validation

`npm test` runs unit tests and the real SQL migration/functions in isolated PostgreSQL WASM (PGlite + pgvector), including public/private reads, RPC permissions, duplicate events, conflicts, reservations, generation claims, publication retries and merges. `npm run typecheck` checks TypeScript. HTTP-backed reader tests also cover the pre-migration schema, pending-fact privacy and genuine database failures. CI builds against both schema versions.

For an isolated production build, run the HTTP fixture in one terminal:

```sh
node tests/fixtures/supabase.cjs
```

In another terminal:

```sh
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329
export NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon
export SUPABASE_SERVICE_ROLE_KEY=fixture-service
export ADMIN_EMAIL=editor@example.test
export CRON_SECRET=fixture-cron
npm run build
npm run start
```

With Playwright available, `node tests/research.browser.cjs` exercises manual source selection, saved editorial direction/experience, explicit generation, the publication boundary and public Fact Flow links. Set `PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium` if using a system browser. This browser test uses a local auth fixture and intercepted composition responses; database correctness is exercised independently by the SQL suite. Neither fixture calls a live Supabase project or a paid generation service. Live model output and production data should be checked in the rollout above.

Against the research-schema fixture, `node tests/manual-ingest.browser.cjs` checks dashboard, individual RSS source, batch and podcast ingestion, including zero-fresh-item runs, saved-candidate processing, suggestion refresh, migration errors and the manual article boundary. It also calls the real research route with an empty queue to check authentication, source-scope validation and the processing response. Collection/model responses are intercepted; the SQL suite separately verifies automatic publication, held untrusted facts and event deduplication.


To reproduce a preview build against the unmigrated schema, start a fresh fixture with `FIXTURE_SCHEMA=legacy node tests/fixtures/supabase.cjs` and use the same isolated build settings above. With that build running, `TEST_SCHEMA=legacy node tests/research.browser.cjs` checks public Fact Flow, RSS and the homepage, plus migration-required responses from authenticated research/publishing endpoints. The legacy fallback only handles missing new publication columns; database outages and permission errors still fail visibly.

`PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node tests/admin-workspace.browser.cjs` checks all 12 admin tools in the grouped Dashboard and header Admin dropdown (including logout), desktop/mobile layouts and Fact Flow card action placement, confirmation panels, newsletter dry-run previews and stats failure recovery against the same isolated fixture. Screenshots are saved under `work/admin-preview/`.


### Editorial article pitches

Apply `20261118_editorial_pitches.sql` after the existing research migrations. It adds nullable `story_groups.pitch` JSON metadata; older suggestions stay readable. A refresh explains the missing migration before calling a model if the column is absent.

Suggested articles now runs two model passes: a broader set of up to 18 proposed angles, followed by a skeptical evidence critique retaining at most 10. Both see up to 60 available processed source candidates, the latest 30 published article titles/excerpts, and 30 previous pitches (including dismissed ones). This is limited editorial memory, not a search across the entire archive. Sources and previous text are treated as data. No live web research or interviews are performed.

The first pass explores contradictions, incentives, consequences and connections beyond semantic similarity. The critique checks reader value, originality and evidence strength. The UI ranks ideas using 40% reader value, 35% originality and 25% evidence, with model-assigned scores labelled as editorial assessments.

- **Ready to develop:** a supported editorial question with no essential missing reporting and an evidence score of at least 4/5. Choosing it opens the existing manual composition workflow with the reader, angle and counterargument as direction. It never generates or publishes automatically.
- **Worth investigating:** a promising but unproven angle, with explicit missing evidence and reporting tasks. It has no direct composition action. Add the evidence as source candidates, then refresh for reassessment; an editor can still independently select sources from Candidates.

Every stored pitch must reference 1–8 supplied candidates, explain each source contribution, name the reader's decision, explain novelty and state a counterargument. Missing evidence or weak evidence downgrades a nominally ready pitch to an investigation. Different questions can reuse the same evidence; identical source/question combinations do not revive dismissed suggestions. Source or recent-coverage changes invalidate the refresh cache. Repeating refresh on unchanged inputs reuses the saved batch.

Review a sample of real pitches after rollout: the automated tests use model fixtures and cannot establish live editorial quality. Neither model scores nor the ready label establish that claims are verified. Older waiting sources remain eligible, but the current 60-source limit means this is not exhaustive archive discovery.

### Suggestion and scheduler failures

Editorial responses now use strict JSON Schema, with source IDs constrained to the current pool. Semantic validation still checks complete reasoning and one contribution per selected source. An entirely invalid critique gets one repair attempt, then fails explicitly without replacing saved suggestions or caching success. A legitimate empty suggestion list is a successful assessment. Suggestion-only errors must not label completed Fact Flow processing as faulty.

For missing automatic collection, first inspect the Ingest workflow run history. A missing scheduled run and a failed HTTP request are different failures. Verify the workflow is active on the default branch; GitHub scheduled workflows can be delayed and do not guarantee exact execution times. The offset gate intentionally skips the seasonally inactive UTC firing.

Inspect the actual step logs before attributing an automation failure to the application. HTTP 429 accompanied by a Vercel Security Checkpoint HTML page means the runner was challenged at the hosting edge, before application cron authentication. Confirm an appropriate authenticated automation exception in the project's Vercel security settings; changing application event matching or repeatedly retrying a browser challenge does not fix it. Keep CRON_SECRET authentication on the application routes. Workflow state and hosting security changes require account access and are not changed by this code patch.


### Auto facts from RSS snippets

Apply `20261119_autopublish_snippet_facts.sql` with the application update. RSS snippet quality no longer prevents automatic Fact Flow publication for a source with Auto facts enabled. Event eligibility, dates, source attribution, duplicate matching and conflict checks still apply; full articles remain manual.

The migration also queues existing clean pending snippet facts from active trusted sources for reconsideration. Run **Process facts and suggestions** after deployment to process these saved candidates without collecting them again. Dismissed candidates, imported non-auto-publish backlog and facts held for review are not requeued.


### Fact Flow admin layout

Fact Flow opens on Pending, with counts on each status filter. Each card contains its own status, source metadata, review message and action row beneath the fact text. Switching filters clears bulk selection. Admin pages use the full content width; the site-header Admin dropdown is the single navigation menu, with the current tool highlighted and logout at the bottom.

### Monthly industry briefings

The monthly report defaults to the previous Warsaw calendar month. Dashboard start/end date controls accept any inclusive date range, including a partial month or a span across months. It uses a bounded selection of the selected period's published industry analyses (up to 60), published Fact Flow items (up to 200), and processed source candidates (up to 120 dated sources plus 30 undated sources collected that month). Available, reserved and used evidence is eligible; dismissed or unprocessed evidence is excluded. Input text has separate section budgets totaling 160,000 characters, including the latest earlier monthly briefing for expectations comparison. Counts returned by the generator reflect the evidence actually included, not total market activity.

The report can now run without a published long-form article if dated source evidence or public facts exist. Undated collected material is background only; the earlier briefing alone cannot establish new activity. Event IDs and review flags help preserve uncertainty and avoid treating repeated reporting as independent developments. Evidence-query errors stop generation rather than implying a quiet month.

The editable **Monthly report (2000-word synthesis)** prompt now asks for two or three supported shifts, a comparison of expectations, practical consequences and a short watchlist with confirming/disconfirming evidence. Approximately 2000 words is a target when justified, not a padding quota. A thin month earns a shorter update. Original-source links are permitted alongside exact LocReport article links; unsupported URLs, missing citations, empty output and truncated completions are rejected before insertion. Generation saves a pending draft for review; only explicit Approve & publish makes it public. A published report can be regenerated as a new draft, while an existing pending draft is returned for review rather than duplicated.

Apply `20261120_monthly_industry_briefing_prompt.sql` to update an already-saved `prompt_monthly` value. The previous value is retained under `prompt_monthly_before_industry_briefing`. Other prompt settings and existing reports are unchanged. The repository default and admin help text are updated too; there is no separate Jekyll generator in this repository. The generator is still admin-only and does not run or publish a real report as part of this code change.


### Monthly report review and publication

Apply `20261121_monthly_report_drafts.sql` before deploying this flow. It adds draft article type/reporting period and article reporting period, preserves the monthly-summary type in the transactional publication function, and allows only one pending/rerun monthly draft per period. Existing published reports remain unchanged.

Dashboard → Generate monthly report creates a pending draft with a frozen evidence snapshot and returns a Review monthly report draft link. Admin → Drafts labels monthly reports and their period. The review page allows editing, source inspection, saving and rejection. Approve & publish uses the existing publication boundary, preserves the report type/period, publishes at approval time, refreshes monthly-report surfaces and creates no new Fact Flow headline. The generic single-source Re-run action is disabled for reports; reject and regenerate from the dashboard if a new synthesis is needed. Edited reports must still cite URLs from their saved evidence pool.

Generation never inserts an article or turns over public caches. Duplicate pending drafts are prevented both before model calls and by a database unique index; a concurrent generation returns the existing draft for review. The reporting period, rather than approval date alone, identifies newer reports for duplicate detection and earlier briefings for comparison. Authentication, malformed/truncated output and citation checks run before any draft is saved.

`PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node tests/monthly-report.browser.cjs` checks dashboard generation, the review link, source inspection, editing/saving and explicit approval using intercepted responses against the local auth fixture. No real report is generated or published.

### Custom report coverage

Apply `20261123_monthly_report_date_range.sql` after the monthly draft migration. It saves inclusive start/end dates on drafts and published reports, backfills existing identified monthly reports, and replaces pending-draft uniqueness by exact range. A partial-month draft can coexist with a full-month draft; repeating the same range opens the existing pending draft instead. An already published report for the exact range still requires regeneration confirmation. Old clients submitting only `monthly_period` retain full-month defaults.

Evidence boundaries use midnight in Europe/Warsaw through midnight after the selected end date, including DST transitions. The prompt and frozen evidence snapshot identify exact coverage, and partial-period titles are instructed to include dates. The earlier briefing must end before the selected start; undated sources remain background only. Draft review and explicit publication remain required, including for testing.
