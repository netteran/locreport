# LocReport — AI Development Guide

> **For AI engines only.** This file is the authoritative structural reference for AI agents working on this codebase. It is blocked from web crawlers via `robots.txt`. Start here before reading any source file.

---

## What This Is

**LocReport** is a Next.js 15 (App Router) content intelligence platform for the language services industry. It ingests RSS feeds three times each workday, uses OpenAI to generate draft articles, routes them through an admin approval workflow, and publishes them with impact scoring and signal tagging.

**Live domain:** `https://locreport.com`
**Repository:** `netteran/locreport`
**Deployment:** Vercel (auto-deploy from main)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.3.3, App Router, TypeScript 5 strict |
| Styling | TailwindCSS 4 + PostCSS, custom CSS vars (`assets/css/style.css`) |
| Database | Supabase (PostgreSQL + pgvector) — SSR + browser clients |
| AI | OpenAI GPT-4o/4o-mini (content generation, classification) + text-embedding-3-small (semantic search) |
| Charts | Recharts 3 (Intelligence dashboard, LocStock + LLM pricing visualizations) |
| Market data | Yahoo Finance 2 (LocStock tickers) |
| Email | Resend (contact form + digest subscriptions with double opt-in) |
| Analytics | Google Analytics 4 (G-1KQKEEP1PL) |
| Deployment | Vercel (no cron jobs — every scheduled task runs from GitHub Actions and calls a `CRON_SECRET`-authenticated route; see Scheduled Jobs) |

---

## Repository Layout

```
app/
  (auth)/login/          — Supabase email/password login
  (public)/              — All public-facing pages (see Route Map below)
  api/                   — API routes (REST handlers + admin utilities)
  layout.tsx             — Root layout: global metadata, GA4 scripts, next/font, pre-paint theme script
  globals.css            — Tailwind imports

components/
  ui/                    — Primitive UI components (Button, Card, Input, Badge, Textarea, Label)
  Nav.tsx                — Site header with dropdown nav + search + theme toggle
  DigestPopup.tsx        — The site's ONLY digest signup. Modal rendered once from
                           (public)/layout.tsx; auto-opens once per visitor, reopenable forever
                           from the footer trigger. See Digest Signup below
  DigestPopupTrigger.tsx — Footer button that reopens DigestPopup via a window event
  SignalSparkline.tsx    — Tiny weekly-volume area chart (signals index/detail + MomentumStrip; Recharts, client)
  MomentumStrip.tsx      — Homepage strip: 4 signals by coverage momentum + sparklines
  BackfillEmbeddingsButton.tsx — Admin one-click embeddings backfill loop
  ArticleCard.tsx        — Article preview row; currently unrendered (the homepage inlines its own rows)
  ArticleEditor.tsx      — Markdown editor (admin only)
  ImageDropzone.tsx      — Drag/drop/paste lead-image field (admin); uploads to Supabase Storage
  DraftCard.tsx          — Draft management card
  ShareButton.tsx        — Social share button on article pages
  ReadingProgress.tsx    — Scroll progress indicator
  BackToTop.tsx          — Scroll-to-top button (rendered in (public)/layout.tsx)
  IngestButton.tsx       — Manual RSS ingest trigger button (admin)
  SourceForm.tsx         — Form for adding/editing RSS sources
  RunFeedButton.tsx      — Manual trigger for /api/scraped-sources/run (one source or all active; admin)
  ScrapedFeedForm.tsx    — Form for adding a generated feed (name, type, URL, ingest keywords, JSON config)

lib/
  supabase/server.ts     — SSR Supabase client (use in Server Components/API routes)
  supabase/client.ts     — Browser Supabase client (use in Client Components)
  types.ts               — Core TypeScript types: Article, Draft, RssSource
  signals.ts             — 13 hardcoded industry signals + SIGNAL_MAP (id → signal)
  openai.ts              — OpenAI client singleton (GPT-4o-mini)
  embeddings.ts          — EMBEDDING_MODEL constant + embedText/embedAndStoreArticle (text-embedding-3-small)
  intelligence.ts        — Signal time-series bucketing + coverage-momentum computation for dashboard charts
  facts.ts               — Fact types/labels + parseHeadlineFact(): pulls the one headline fact out of a
                           distillation, tolerating numbered/bullet/bare-prose formatting drift
  factFlow.ts            — ensureArticleFact(): the one-fact-per-article guarantee every publish path calls.
                           See Fact Flow below
  topics.ts              — Topic definitions (signals + keywords) shared by /articles filters and badges
  email/
    templates.ts         — Inline-styled HTML email builders (confirm + digest)
    digest.ts            — Pure digest composition: selectForSubscriber() narrows the week's
                           articles to one subscriber's preferences, composeDigest() splits the
                           result into top story / signal briefings / roundup
    send.ts              — Resend client helper, SITE_URL, digest from-address
  prompts.ts             — LLM system prompts (also editable in DB settings table)
  classify.ts            — Article classification logic (impact, signals, segments, implications)
  rss.ts                 — RSS parsing, HTML-to-text, Google News redirect resolution
  feedGenerator.ts       — Feed generator: scrapes an HTML listing page (cheerio + CSS selectors) or
                           re-filters an existing feed by keyword, for scraped_sources rows; builds the
                           RSS XML served at /api/feeds/[name]. Replaces the external
                           aparasion/rss-generator for all but one feed — see scraped_sources
  scrapedSourceConfig.ts — camelCase JSON (config.json-shaped) ↔ scraped_sources column mapping, shared by
                           ScrapedFeedForm and the /admin/scraped-feeds inline editor
  feedUrl.ts             — feedUrl(name) → the canonical https://locreport.com/api/feeds/<name>. Shared by the
                           generator's atom:link and the admin "Add to Sources" button so they cannot disagree
  slugify.ts             — URL-safe slug generation
  storage.ts             — Supabase Storage constants for article images (bucket name, size/MIME limits, object key builder)
  utils.ts               — articleHref(), extractTeaser(), cn() (Tailwind merge), escapeXml() (shared by every RSS-emitting route)
  revalidate.ts          — revalidateArticleSurfaces()/revalidateFactSurfaces(): on-demand cache
                           invalidation every article/fact write path calls, so a publish appears at once
                           instead of waiting out the page's ISR window. See ISR Revalidation below
  data/
    events.ts            — 2026 industry calendar (11 events, hardcoded)
    directory.ts         — 31 localization tech vendors (hardcoded)
    llm-pricing.ts       — LLM provider pricing (22 models tracked across 9 providers incl. OpenAI, Anthropic, Google, Meta, DeepSeek, Moonshot AI/Kimi, xAI, Alibaba/Qwen, Mistral); static values are the seed/fallback, overlaid at render time with live data from `llm_pricing_quotes`/`llm_pricing_history` (see `/api/llm-pricing`)

assets/
  css/style.css          — Design system: indigo-blue palette, Space Grotesk + Inter fonts
  data/market_quotes.json — Cached ticker prices for LocStock (updated by /api/market-quotes)

public/
  favicon.ico, icon.png  — Favicons
  logolight.png          — Logo for light mode
  logodark.png           — Logo for dark mode
  og-image.jpg           — OG image (1200×630)

vercel.json              — Build config + 301 redirects. No `crons` key: scheduling lives in GitHub Actions
```

---

## Route Map

### Public Routes (`app/(public)/`)

| Path | File | Notes |
|---|---|---|
| `/` | `page.tsx` | Split hero (gradient wash + orbs, Explore-tools panel) → sources marquee → "Highlighted story" briefing + high-impact rail → momentum strip → day-grouped stream (3 days) → CTA; sidebar carries Fact Flow, reports, active signals. **Runs the pre-2026-08-17 visual system — see Design System below.** |
| `/articles` | `articles/page.tsx` | All articles — server-side filters + pagination via URL params (`topic`, `impact`, `category`, `from`, `to`, `sort`, `page`) |
| `/articles/[slug]` | `articles/[...slug]/page.tsx` | Article detail, 24h ISR revalidation |
| `/intelligence` | `intelligence/page.tsx` | Signals dashboard + stats |
| `/intelligence/signals` | `intelligence/signals/page.tsx` | All 13 active signals |
| `/intelligence/signals/[id]` | `intelligence/signals/[id]/page.tsx` | Signal detail + linked articles |
| `/intelligence/high-impact` | `intelligence/high-impact/page.tsx` | Articles with impact score ≥ 4 |
| `/reports` | `reports/page.tsx` | Reports hub (annual + monthly) |
| `/reports/2026-annual-global-market-report` | `reports/2026-annual.../page.tsx` | Hardcoded static annual report |
| `/reports/monthly` | `reports/monthly/page.tsx` | Dynamic monthly reports from DB |
| `/compass` | `compass/page.tsx` | Tools hub overview |
| `/compass/locstock` | `compass/locstock/page.tsx` | Market index + Recharts |
| `/compass/events` | `compass/events/page.tsx` | 2026 industry events calendar |
| `/compass/llm-pricing` | `compass/llm-pricing/page.tsx` | Interactive LLM pricing simulator + history chart |
| `/compass/directory` | `compass/directory/page.tsx` | 31 localization tech vendors |
| `/fact-flow` | `fact-flow/page.tsx` | Day-grouped stream of published facts — one per article. Shows only facts with an `article_id` |
| `/fact-flow/feed.xml` | `fact-flow/feed.xml/route.ts` | Fact Flow RSS (latest 100 linked facts) |
| `/search` | `search/page.tsx` | Hybrid semantic + full-text search (`?q=...`), RRF-ranked via `hybrid_search_articles` RPC with keyword/ilike fallbacks |
| `/subscribe/confirm` | `subscribe/confirm/page.tsx` | Double-opt-in confirmation (`?token=`), noindex |
| `/subscribe/manage` | `subscribe/manage/page.tsx` | Tokenized digest preferences (week-in-brief roundup on/off, signal briefings, min impact), noindex |
| `/subscribe/unsubscribed` | `subscribe/unsubscribed/page.tsx` | Post-unsubscribe confirmation, noindex |
| `/feed.xml` | `feed.xml/route.ts` | Articles RSS feed (latest 50) |
| `/about` | `about/page.tsx` | About page |
| `/contact` | `contact/page.tsx` | Contact form (uses Resend) |
| `/privacy` | `privacy/page.tsx` | Privacy policy |
| `/terms` | `terms/page.tsx` | Terms of service |

> Note: `/language-science` no longer exists as a route — it redirects to `/articles` via vercel.json.

### Client Components (co-located with pages)

Several Compass and other sections use co-located client components:
- `compass/locstock/LocStockClient.tsx` + `LocStockChart.tsx`
- `compass/llm-pricing/PricingClient.tsx` + `PricingHistoryChart.tsx`
- `compass/events/EventsClient.tsx`
- `compass/directory/DirectoryClient.tsx`
- `search/SearchRefine.tsx`

### Admin Routes (`app/(public)/admin/`) — Auth-gated

| Path | Purpose |
|---|---|
| `/admin` | Dashboard: stats banner + a compact action list (`.admin-actions` in `style.css`). Each row is title + controls; the long description collapses behind the title toggle, while confirmation panels and result messages always render inline. Actions: ingest, embeddings backfill, monthly report, digest send (weekly), Fact Flow backfill (one slug, or **Backfill all** to walk every article still missing its fact), market quotes, LLM pricing |
| `/admin/articles` | Article list management |
| `/admin/articles/[id]` | Edit individual article |
| `/admin/drafts` | Draft review queue (pending/approved/rejected) |
| `/admin/drafts/[id]` | Edit/approve/reject individual draft |
| `/admin/compose` | Manually write a new article |
| `/admin/prompts` | Edit LLM system prompts stored in DB |
| `/admin/sources` | Manage RSS feed sources |
| `/admin/scraped-feeds` | Feed generator: generated **feeds** (HTML selectors or keyword-refiltered feeds) published at `/api/feeds/[name]`. Deliberately says "feeds", never "sources", so it is not confused with `/admin/sources` — the old `/admin/scraped-sources` path 301s here via `vercel.json`. Per-feed and run-all triggers, inline JSON config editor, an **Add to Sources** button per feed, and a badge showing whether ingest can see it (`in Sources` / `not in Sources` / `0 items`) |
| `/admin/direct` | Direct article ingestion tool |
| `/admin/events` | Event management |

### API Routes (`app/api/`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ingest` | GET/POST | RSS fetch → draft creation |
| `/api/market-quotes` | GET/POST | POST: fetch ticker prices + history from Yahoo Finance, upsert to `market_quotes` table (admin session or CRON_SECRET). GET: read cached quotes |
| `/api/llm-pricing` | GET/POST | POST: fetch current per-token pricing from OpenRouter, upsert to `llm_pricing_quotes`/`llm_pricing_history` (admin session or CRON_SECRET). GET: read cached pricing + history |
| `/api/monthly-report` | POST | Generate monthly synthesis via OpenAI |
| `/api/drafts` | GET/POST | List/create drafts |
| `/api/drafts/[id]` | GET/PATCH/DELETE | Draft CRUD |
| `/api/drafts/[id]/rerun` | POST | Re-run Stage 2 only — reuses `drafts.extracted_facts` so the facts can't drift. Optional JSON body `{ instruction }` (≤2000 chars) is injected as a second system message that may reshape angle/structure/emphasis/length but not the facts. Responds with the updated draft plus `facts_reused` |
| `/api/articles` | GET/POST | List/create articles |
| `/api/articles/[id]` | GET/PATCH/DELETE | Article CRUD |
| `/api/compose` | POST | Publish manually-composed article |
| `/api/contact` | POST | Contact form → Resend email |
| `/api/me` | GET | Current user + admin status |
| `/api/settings` | GET/POST | App settings (prompts, admin prefs) |
| `/api/sources` | GET/POST | RSS source management |
| `/api/sources/[id]` | PATCH/DELETE | Single RSS source |
| `/api/scraped-sources` | GET/POST | Feed-generator scrape source management |
| `/api/scraped-sources/[id]` | GET/PATCH/DELETE | Single scrape source CRUD |
| `/api/scraped-sources/[id]/link` | POST | Admin-only: promotes a generated feed into an `rss_sources` row so ingest reads it, copying the feed's `keywords` across. Builds the URL server-side from `SITE_URL` (ingest fetches it from a serverless function, so a `window.location` origin would break outside production) and is idempotent — a second call returns the existing row with `already_linked: true` |
| `/api/scraped-sources/run` | GET/POST | Regenerates every active scrape source (or one, via `?id=`) and stores the resulting XML on the row (admin session or CRON_SECRET). Called by `ingest.yml` immediately before each ingest run, and by the `/admin` + `/admin/scraped-feeds` run buttons. Always answers 200 — per-source failures are reported in the body (`failed`, `results[]`), so one broken scrape never blocks ingest |
| `/api/feeds/[name]` | GET | Public: serves one scrape source's most recently generated RSS XML — this is the URL an `rss_sources` row points at |
| `/api/stats` | GET | Dashboard stats: article/draft/source counts |
| `/api/seen-urls` | GET | Legacy Jekyll URLs (deduplication) |
| `/api/events` | GET/POST | Events CRUD |
| `/api/events/[id]` | GET/PATCH/DELETE | Single event |
| `/api/direct` | POST | Direct article submission |
| `/api/admin/backfill-authors` | POST | Admin utility: backfill article authors |
| `/api/admin/reclassify` | POST | Admin utility: reclassify articles via LLM |
| `/api/facts` | POST | Admin: add a fact by hand, optionally linked to an article by slug |
| `/api/facts/[id]` | PATCH/DELETE | Edit a fact's text or article link; delete it |
| `/api/admin/backfill-facts` | POST | Gives articles their missing Fact Flow fact. `{slug}`/`{article_id}` does one; `{all:true, limit}` walks the next batch with no fact (newest first, monthly reports excluded) and returns `{created, skipped, processed, remaining}`. Never overwrites an article that already has one, and dates each fact to its article's `published_at` so a backfill slots into the stream in order instead of burying it |
| `/api/tweet-facts` | POST | Posts untweeted published facts to X (CRON_SECRET only). **Dormant — nothing calls it; see Fact Flow** |
| `/api/admin/backfill-embeddings` | POST | Embed articles with null embedding, batched; returns `{embedded, remaining}` (admin session or CRON_SECRET) |
| `/api/uploads/article-image` | POST | Admin-only: validates type/size, ensures the `images` storage bucket exists, returns a signed upload URL + public URL. The bytes never pass through the route |
| `/api/subscribe` | POST | Digest signup → pending subscriber + Resend confirm email (double opt-in) |
| `/api/subscribe/preferences` | POST | Token-authenticated preference updates (`signal_prefs`, `include_summary`, `min_impact`) / unsubscribe. Rejects a combination that would select nothing — summary off with no signals picked |
| `/api/subscribe/unsubscribe` | GET/POST | One-click unsubscribe (`?token=`); POST is the RFC 8058 List-Unsubscribe target |
| `/api/digest/send` | POST | Compose + send the personalized weekly digest via Resend batch (CRON_SECRET or admin). Always a 7-day period — there is no frequency parameter. `?dry=1` resolves the recipient list without emailing or recording a send — powers the admin dashboard's preview-then-confirm button |

---

## Database Schema (Supabase)

### `articles`
```
id uuid PK
title text
slug text UNIQUE
excerpt text
content text (markdown)
article_type 'industry' | 'theory' | 'monthly-summary'
author text
publisher text
source_url text
image_url text                 — optional lead image (hero on the article, thumbnail in listings)
image_alt text                 — optional alt text; falls back to the title
signal_ids text[]
signal_stance text
signal_confidence text
impact_score int (1–5)
time_horizon 'now' | '6months' | 'long-term'
affected_segments text[]
business_implications text[]
tags text[]
published_at timestamptz
updated_at timestamptz
draft_id uuid FK → drafts.id
embedding vector(1536)         — pgvector, HNSW-indexed; set on publish, backfillable
fts tsvector (generated)       — weighted full-text column (title A, excerpt B, content C), GIN-indexed
```

RPCs (in `supabase/migrations/20260708_pgvector_search.sql`): `hybrid_search_articles(query_text, query_embedding, match_count)` — Reciprocal Rank Fusion of vector + full-text rankings; `keyword_search_articles(query_text, match_count)` — full-text fallback; `match_articles(query_embedding, match_count, exclude_id)` — nearest neighbors for related reading.

### `drafts`
```
id uuid PK
title text
slug text
content text
source_url text
source_feed_id uuid FK → rss_sources.id
source_published_at timestamptz
image_url text             — optional lead image, carried onto the article on approval
image_alt text
status 'pending' | 'approved' | 'rejected' | 'rerunning' | 'rerun'
extracted_facts text       — raw Stage 1 fact sheet the draft was written from; re-runs reuse it verbatim
created_at timestamptz
updated_at timestamptz
```

`extracted_facts` is set by ingest and reused by `/api/drafts/[id]/rerun`, so a re-run only re-profiles the
Stage 2 prose and never re-derives the facts. Null on drafts created before the column, or created outside
ingest (`/api/drafts` POST, `/admin/direct`) — the first re-run of such a draft extracts once and pins the
result, so every later re-run of it profiles the same facts.

### `facts`
```
id uuid PK
content text                   — the published sentence
category text                  — 'news' for everything the pipeline writes
source_url / source_name text
draft_id uuid FK → drafts.id   — set while the fact waits on an unapproved draft
article_id uuid FK → articles.id — set on approval; NULL means not public
tweeted_at timestamptz / tweet_id text — written only by /api/tweet-facts (dormant)
created_at timestamptz
```
Public read via RLS (`facts_public_read`); writes are service-role only. **`article_id` is what
publishes a fact** — `/fact-flow`, its RSS feed and the homepage rail all filter on
`article_id is not null`, so a fact parked on a draft is invisible until that draft is approved.

### `rss_sources`
```
id uuid PK
url text
name text
active boolean
created_at timestamptz
```

### `scraped_sources`
```
id uuid PK
name text UNIQUE
type 'html' | 'rss'        — html: scrape a listing page via CSS selectors; rss: re-filter an existing feed
url text
active boolean
article_selector / title_selector / link_selector / description_selector / date_selector text  — html type only
link_pattern text           — substring a candidate link must contain
feed_title / feed_description text
content_filter jsonb        — { keywords: string[], minMatches?, checkFullContent?, maxScan? }; null = no filter — GENERATION-time filter
keywords text[]             — INGEST-time filter, copied to rss_sources.keywords by the Add to Sources button
classified_links jsonb      — per-article relevance memo so a content-filtered source isn't re-classified every run
generated_xml text          — most recent output; served as-is by GET /api/feeds/[name]
last_run_at / last_status ('success'|'error') / last_error / last_item_count
created_at / updated_at timestamptz
```
RLS enabled with no policies — service-role access only. Regenerated by `/api/scraped-sources/run` (lib/feedGenerator.ts). An `rss_sources` row consumes a generated feed by pointing its `url` at `/api/feeds/<name>` — created for you by the **Add to Sources** button on `/admin/scraped-feeds`.

**Naming:** the user-facing surface says **"feeds"** throughout (`/admin/scraped-feeds`, `ScrapedFeedForm`, "Add feed") so it is never mistaken for the `/admin/sources` section, while the table and API paths keep their original `scraped_sources` spelling. That split is deliberate — renaming the table and routes would buy nothing and would break the `ingest.yml` curl during a deploy window. Don't "fix" the inconsistency by half.

**This generator replaced the external `aparasion/rss-generator` on 2026-09-14.** Twelve active `rss_sources` rows now point at `/api/feeds/<name>`, and `/api/scraped-sources/run` is invoked by `ingest.yml` immediately before each ingest run, so the XML is always minutes old when read.

**The external generators are gone.** All 13 active `rss_sources` scrape rows now point at
`/api/feeds/<name>`; no row references `aparasion.gitlab.io` or `aparasion.github.io` any more, and the
GitLab project can be retired. The legacy `CSA Research Blog` row (GitHub Pages, long inactive, no drafts
referencing it) was deleted outright — nothing replaces it, so re-adding CSA Research means building a new
scrape source.

`DeepL-Press-Releases` and `LingopalAI` were switched over on the owner's call while both were still
extracting **0 items**, on the basis that neither site has published for a fortnight. Note the mechanism
does not actually support that reading: **the generator applies no date or recency filter anywhere** —
`collectHtmlCandidates` takes whatever the listing page shows and `buildFeedXml` emits all of it, so stale
posts still yield items. A 0-item HTML scrape means extraction matched nothing on the page, not that the
source is quiet. (The 30-day cutoff lives in `/api/ingest`, downstream of the feed.) Treat both as
unproven: when either site publishes again, a broken extractor and a quiet source look identical from here.
Their selectors are the first thing to re-check if new posts fail to appear.

DeepL's selectors (`article` / `h3` / `a[href*='/press-release/']` / `time`, pattern `/press-release/`) were
validated against the live markup and use **no class names at all** — the page is built from Tailwind
utilities and hashed CSS-module names (`richText-module__sMfSca__…`) that rotate on every frontend deploy.
Prefer semantic elements over classes on any source built this way. Its `<time>` carries no `datetime`
attribute, so the date comes from the element text ("September 1, 2026"), which `parseArticleDate` handles.
The listing URL is set to `https://www.deepl.com/en/press-release`; an earlier run against
`https://www.deepl.com/en/press` returned HTTP 200 but contained no `/press-release/` href anywhere, not
even via the anchor fallback.

`DATAmundi-Newsroom` was removed on 2026-09-14: datamundi.ai answers `HTTP 403` to the scraper, which is bot protection rather than a selector problem. One older `aparasion.github.io` row also survives, inactive.

A `/api/feeds/<name>` row only works if the scrape source is `active` **and** has non-empty `generated_xml` — otherwise the route 404s. When adding one, run the generator first and confirm `last_status='success'` **and a non-zero `last_item_count`** (see the silent-empty-feed trap above).

`Acclaro-Press` was added on 2026-09-16 from a pasted card snippet, not a live fetch — the agent
environment had no general outbound network access at the time, so neither the listing URL nor the
selectors were verified against the real page. `url` is `https://www.acclaro.com/press`, inferred from
the item link path (`/press/<slug>`); confirm it resolves before relying on this source. Selectors:
`.w-dyn-item` / `h4` / `a.mv-rc-link-wrap[href*='/press/']`, pattern `/press/` — Webflow's generic
collection-item wrapper, narrowed by the link's own class and href since `resource-card` (the visible
card class) reads like a shared component that could be reused for more than press releases. The card
carries no date anywhere (no `<time>`, no date text), so `date_selector` is unset and every item
publishes with no `pubDate` — harmless, since `/api/ingest` treats a missing date as "don't filter out"
rather than dropping it. **Not yet linked to `rss_sources`** — run it and confirm a non-zero
`last_item_count` before clicking Add to Sources.

Known weak scrapes as of 2026-09-14, all reporting `success`:

| Source | Items | Filter? | Read as |
|---|---|---|---|
| `LingopalAI` | 0 | no | Extracting nothing from `lingopal.ai/industrynews-blog`; now on `/api/feeds` regardless. Needs new selectors |
| `DeepL-Press-Releases` | 0 | no | Extracting nothing yet; URL retried at `/en/press-release` |
| `PRNewswire-L10N` | 0 | yes | Suspect — the keyword filter could legitimately exclude everything, but not at PR Newswire's volume |
| `XTM-Blog` | 1 | no | Suspect — a blog index should yield more than one |
| `OpenAI-News-L10N` | 0 | yes | Plausible; narrow keywords over a low-volume feed |
| `Cohere-Newsroom-L10N` | 1 | yes | Plausible |

Compare a suspect source against its still-live GitLab counterpart (`https://aparasion.gitlab.io/rss-generator/rss/<Name>.xml`) to decide whether to fix the selectors or revert the row.

### `settings`
```
key text PK
value text
```
Stores: `DEFAULT_INDUSTRY_PROMPT`, `DEFAULT_EXTRACTOR_PROMPT`, `DEFAULT_MONTHLY_PROMPT`, `DEFAULT_THEORY_PROMPT`, admin preferences.

### `seen_urls`
```
url text PK
```
Populated from legacy Jekyll migration to prevent re-ingesting old content.

### `subscribers`
```
id uuid PK
email text UNIQUE
status 'pending' | 'active' | 'unsubscribed'
signal_prefs text[]        — signal ids from lib/signals.ts to get a dedicated briefing section
                             for; empty = no briefings (the general roundup alone)
include_summary boolean    — carry "the week in brief", an impact-ranked roundup of everything
                             published in the period, alongside any signal briefings
min_impact int (1–5)
confirm_token uuid         — double-opt-in link
manage_token uuid          — preferences/unsubscribe links
confirmed_at / unsubscribed_at / last_sent_at timestamptz
created_at timestamptz
```
RLS enabled with no policies — service-role access only. Same for `digest_sends`.

**The digest is weekly-only.** The `frequency` column and the daily cadence were removed on
2026-09-14 (`supabase/migrations/20260914_weekly_digest_prefs.sql`); do not reintroduce a per-subscriber
cadence without also restoring the second `digest.yml` schedule pair and its DST guard entries.

`signal_prefs` no longer acts as a filter on its own — it selects *extra* briefing sections. What a
subscriber receives is the union of (the whole period, if `include_summary`) and (anything tagged with a
followed signal), with `min_impact` as a floor on both. A `subscribers_digest_content_check` constraint
forbids the empty combination (`include_summary` false with no signals), and both
`/api/subscribe/preferences` and the manage form refuse it before it reaches the DB. The migration
switched `include_summary` off for anyone who already had signal picks, so no existing digest silently
widened.

### `digest_sends`
```
id uuid PK
subscriber_id uuid FK → subscribers.id
period_start / period_end timestamptz
article_ids uuid[]
resend_id text
sent_at timestamptz
```
Audit trail + idempotency for digest runs (re-runs skip subscribers with `last_sent_at` inside the period).

### `llm_pricing_quotes`
```
model_id text PK          — matches LLMModel.id in lib/data/llm-pricing.ts
data jsonb                — {input, output, context, provider, name} ($ per 1M tokens)
updated_at timestamptz
```
Current pricing snapshot, refreshed by `/api/llm-pricing` POST from the OpenRouter public models API. RLS enabled with no policies — service-role access only. Same for `llm_pricing_history`.

### `llm_pricing_history`
```
id uuid PK
model_id text
date date
input / output numeric    — $ per 1M tokens
created_at timestamptz
UNIQUE(model_id, date)
```
One row per price change per model (a new row is only inserted when the price differs from the latest stored value), powering the `/compass/llm-pricing` history chart alongside the static seed history in `lib/data/llm-pricing.ts`.

### Storage buckets

| Bucket | Public | Contents |
|---|---|---|
| `images` | yes | Article lead images. Editor uploads land under `articles/<yyyy>/<mm>/`; objects at the bucket root are older hand-uploads from the Supabase dashboard, still referenced by live articles. 10 MB / image, JPG-PNG-WebP-AVIF-GIF only. Writes go through a service-role signed upload URL (`/api/uploads/article-image`), so no `storage.objects` RLS policy is involved |
| `directory-logos` | yes | Vendor logos uploaded in `/admin/directory` (uploaded straight from the browser client) |

---

## Content Pipeline

```
1. INGEST (GitHub Actions, 10am/1pm/5pm Warsaw on workdays, or workflow_dispatch)
   → First POST /api/scraped-sources/run so every scrape source republishes
     fresh XML at /api/feeds/<name> before it is read
   → Fetch active RSS sources from DB
   → Deduplicate against seen_urls
   → For each new item: fetch full text via DEFAULT_EXTRACTOR_PROMPT (OpenAI)
   → Extract metadata via DEFAULT_INDUSTRY_PROMPT (OpenAI):
       title, excerpt, signal_ids, impact_score, time_horizon,
       affected_segments, business_implications, tags
   → Insert draft with status='pending'
   → Distil ONE headline fact from the Stage 1 sheet via DEFAULT_FACTFLOW_PROMPT and
     park it on the draft (facts.draft_id set, article_id still null — not yet public)

2. ADMIN REVIEW
   /admin/drafts
   → Admin reads draft, edits if needed
   → Approve → status='approved' → triggers article creation
   → Reject → status='rejected'
   → Rerun → calls /api/drafts/[id]/rerun → status='rerunning' → Stage 2 regenerates
     from the stored Stage 1 facts (Stage 1 is not re-run). The confirm panel carries an
     optional free-text instruction for Stage 2 — leave it blank to re-run as is.

3. PUBLISH
   Approved draft → article record created with all signal/impact metadata
   → ensureArticleFact() promotes the draft's parked fact onto the article, or
     distils one now if there isn't one. The article is never published without
     its Fact Flow entry — see Fact Flow below
   Article appears on public site immediately (ISR revalidation handles caching)

4. MONTHLY REPORT (manual trigger from admin dashboard)
   /api/monthly-report
   → Fetches all articles from previous month
   → Sends to OpenAI for synthesis
   → Creates article with article_type='monthly-summary'
```

---

## Signals System

Signals are the intelligence layer — 13 hardcoded trend signals in `lib/signals.ts`.

Each signal has:
- `id`, `title`, `category`, `current_status`, `momentum`
- `first_seen` date, `description`, `keywords`, `watched_tickers` (stock symbols)
- Categories: `quality`, `operations`, `governance`, `market`, `strategy`
- Status: `supported`, `emerging`, `disputed`
- Momentum: `rising`, `stable`, `declining`

`SIGNAL_MAP` (Map<id, signal>) is used across the codebase to resolve signal IDs to signal objects. Articles can be tagged with multiple `signal_ids`.

**Current signals (13):**
1. `quality-gap-closure` — AI quality gap reduced with human-in-the-loop validation
2. `governance-in-ai-workflows` — Translation governance in AI assistant workflows
3. `localization-operating-system` — End-to-end AI localization platforms
4. `measurable-quality-evaluation` — MQM-style quality evaluation becoming API-native
5. `translation-memory-obsolescence` — Traditional TM displaced by LLM-native approaches
6. `human-post-editing-contraction` — MTPE volume declining in high-resource pairs
7. `agentic-localization-workflows` — AI agents autonomously managing localization pipelines
8. `multimodal-content-localization` — Localization expanding to video/audio/interactive
9. `regulatory-fragmentation` — Diverging regional AI/language regulations
10. `localization-first-content-design` — Organizations designing content locale-aware
11. `multilingual-llm-gap` — LLM quality degrades for non-English/low-resource pairs
12. `ai-company-language-strategy` — AI labs making explicit product decisions on language
13. `lsp-relevance-erosion` — Boutique/mid-tier LSPs losing relevance vs. mega-LSPs/direct-to-AI

To add a new signal: edit `lib/signals.ts`. No DB migration needed — signals are pure code.

---

## Fact Flow

`/fact-flow` is a stream of one-sentence industry facts. **Every article carries exactly one — the
single most important fact in it — and it is published automatically when the article is.**

How that is guaranteed:

- `lib/factFlow.ts` → `ensureArticleFact()` is the single entry point, and **every path that creates an
  article calls it**: the approve branch of `/api/drafts/[id]` (which is where ingest, `/admin/compose`
  and `/admin/direct` all end up) and `/api/articles` POST. It promotes the fact ingest parked on the
  draft; if there is none it distils one from `drafts.extracted_facts`, falling back to the article body.
- It is **idempotent** — an article that already has a fact is left alone, so re-approving a draft or
  re-running a backfill never duplicates or overwrites.
- It **never throws**. Publishing an article must not fail because the fact step did, so callers get a
  status back and failures are logged (`[factflow]`, `[ingest]`, `[drafts]`).
- `DEFAULT_FACTFLOW_PROMPT` returns one fact or the literal `NO_FACT`. `parseHeadlineFact()` takes the
  first item and tolerates numbered, bullet, bold-prefixed or bare-prose output.

**Why the guarantee exists.** Facts used to be distilled onto the *draft* at ingest and merely linked at
approval, so whenever distillation returned nothing the article published with no fact and nothing
surfaced the gap — 19 of the 238 articles published after Fact Flow launched had none. The old prompt also
asked for "1–2" facts and the parser sliced to 3, so coverage was 0–3 per article rather than one.

Articles published before 2026-06-24 predate Fact Flow and have no fact. Fill gaps with **Backfill all**
on `/admin` (`/api/admin/backfill-facts` with `{all:true}`) — each fact is dated to its article's
`published_at`, so backfilling slots old facts into the stream chronologically instead of dropping months
of old news at the top. Monthly reports are excluded by design: they synthesise facts Fact Flow already
carried, and the prompt bans meta-commentary about reports.

**Publishing to X is a separate, dormant feature.** `/api/tweet-facts` and `facts.tweeted_at` exist and
look complete, but nothing has ever called the route — there is no workflow, no Vercel cron and no admin
button, and it accepts only `Bearer $CRON_SECRET`, so there is no manual path either. It has posted 0
tweets. Wiring it up means adding a workflow under `.github/workflows/` (not a Vercel cron — see
Scheduled Jobs) and setting `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`.
Note it posts oldest-first, so anything that turns it on should deal with the standing backlog.

---

## Design System

**Design tokens** are in `assets/css/style.css` as CSS variables:

```
--accent / --accent-hover / --accent-soft / --accent-light
                     Primary brand — indigo-blue (#2C3CB8 light, #6E7FE8 dark), spent with restraint
--gold / --warm      Secondary micro-accent — reserved for one rare highlight, not decoration (#93650F light)
--bg / --bg-secondary / --surface
                     Surfaces — flat paper, no gradients/glass (white/#F5F5F4 light, #0B0C0E/#151619 dark)
--text / --muted     Ink tones (#17181C / #62636B light; #F2F2F0 / #9A9CA3 dark)
--border / --hairline Subtle separators — hairlines over shadows for elevation
--font-display       Space Grotesk (headings, Google Fonts)
--font-body          Inter (body, system font stack)
--font-mono          JetBrains Mono (code + micro-labels/eyebrows)
--site-max-width     1200px
--content-width      760px
--page-gutter        Responsive padding (0.75rem mobile → 1.5rem desktop)
--radius-sm/md/lg/xl Border-radius scale (4px → 14px) — tightened, institutional rather than bouncy
--space-1 … --space-16  Spacing scale (0.25rem → 8rem)
```

Design direction (everything except the homepage): institutional-editorial — near-monochrome ink/paper,
the single indigo accent used sparingly (links, active states, one eyebrow per page), no decorative
gradients/orbs/glassmorphism/marquees. Prefer flat surfaces + hairline borders over shadows; reserve
`--gold`/`--warm` for a single deliberate highlight, not broad theming.

**The homepage is a deliberate exception.** It runs the visual system the site had on 2026-08-16 — split
hero with gradient wash and drifting orbs, a sources marquee, card shadows, the brighter `#3550F5` accent,
and the softer radius scale. That system lives entirely inside `assets/css/style.css` under the `.home-v1`
scope, matched by the wrapper `<div className="home-v1">` in `app/(public)/page.tsx`.

Working on it:
- The `.home-v1` rule redeclares the **full** Aug 16 token set, not just the values that differ, because it
  sits later in the file than the global `[data-theme="dark"]` block at equal specificity — a partial
  light-mode set leaks into dark mode.
- It also redeclares `color`, because `<body>` resolved that from the global `--text` before the scope
  existed and inheritance carries the computed colour, not the variable.
- Keep new homepage rules inside the scope. Do not re-point them at the global tokens, and do not lift them
  out to global selectors — that is what would bleed this palette onto the rest of the site.

**Theme:** `data-theme="dark"` on `<html>` activates dark mode via CSS variable overrides.

### The Weekly (digest signup)

**The reader-facing name of the email is "The Weekly".** It is never called a *digest* or a *newsletter*
anywhere a subscriber can see — not in the popup, the footer link, the confirm/manage/unsubscribed pages,
the email subjects, or the email bodies. Keep it that way when touching any of that copy.

Internals still say `digest` throughout — `/api/digest/send`, the `digest_sends` table, `DigestPopup`,
`composeDigest`, `lib/email/digest.ts`, `DIGEST_FROM_EMAIL`. That split is deliberate: renaming routes,
tables and env vars would buy nothing and would break the `digest.yml` curl during a deploy window. Don't
"fix" the inconsistency by half — change reader-facing strings only.

`components/DigestPopup.tsx` is the **only** signup surface on the site. The inline forms it replaced —
the homepage and `/intelligence` `.subscribe-band` sections and the article-footer `.post-subscribe`
block, all driven by a since-deleted `SubscribeForm.tsx` — were removed on 2026-09-14. Do not reintroduce
an inline form; add entry points by dispatching to this popup instead.

It mounts once in `app/(public)/layout.tsx`, so it renders **outside** the `.home-v1` scope and therefore
reads the global institutional tokens on every page, homepage included. Keep its CSS global for that
reason — scoping it would give the homepage a second visual treatment of the same component.

Auto-open rules (all tunable via the constants at the top of the file):
- Fires at `DELAY_MS` (45s) **or** `SCROLL_FRACTION` (50% scroll depth), whichever lands first.
- Gated behind `MIN_PAGE_VIEWS` (**1**) views in the session, counted in `sessionStorage` on each
  pathname change. At 1 the popup can fire on the landing page, so single-page visits (search → article
  → leave) are reached and the delay/scroll thresholds are the real gate. The counter is written by an
  effect declared above the arming effect, so it is already 1 when the gate is read on a first load.
  Raise to 2 to require a second page view on top of the thresholds.
- Fires at most once per page load (`armedRef`), and once per visitor overall.

`localStorage['locreport.digest']` holds `{status, at}`: `dismissed` suppresses the auto-open for
`DISMISS_DAYS` (60), `subscribed` suppresses it permanently. Every storage read/write is wrapped in
try/catch — private windows and blocked site data throw, and the page must still render.

The footer trigger dispatches the `locreport:digest-open` window event, which **bypasses every
suppression rule** — the visitor asked for it. That event is the supported way to open the popup from
anywhere; it needs no shared provider, so Server Components can host a trigger.

**TailwindCSS 4:** Configured through PostCSS. Custom CSS vars integrate with Tailwind utility classes.

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anon key (public)
SUPABASE_SERVICE_ROLE_KEY     — Supabase service role key (server-only, never expose)
OPENAI_API_KEY                — OpenAI API key
RESEND_API_KEY                — Resend email service key
CRON_SECRET                   — Secret to authenticate cron requests
DIGEST_FROM_EMAIL             — Optional digest sender (falls back to Resend onboarding address until locreport.com is verified in Resend)
```

---

## Key Patterns & Conventions

### Supabase client selection
- **Public pages (no session needed):** `createPublicClient()` from `@/lib/supabase/server` — cookie-free,
  so the page stays statically renderable. **This is the default for anything under `(public)/` that is not
  an admin surface.** It also carries `fetchWithRetry`, which caps each request and retries transient
  gateway failures (see below).
- **Anything that reads the signed-in user (admin surfaces):** `await createClient()` — reads cookies.
- **Client Components:** `import { createBrowserClient } from '@/lib/supabase/client'`
- **Admin operations needing service role:** use `createServiceClient()` from `server.ts`

**Do not reach for `createClient()` on a public page.** `cookies()` is a Next.js Dynamic API: touching it
opts the page out of static rendering, so its `export const revalidate` silently stops meaning anything and
every visitor pays a live round trip to Supabase. That is exactly how the site came to make ~4,000 article
queries a day and to show empty pages whenever Supabase's gateway wobbled. If a public page needs to know
whether an admin is looking at it, resolve that in a Client Component (`components/AdminEditLink.tsx` is the
worked example) rather than reading the session on the server.

### Metadata
- Root defaults in `app/layout.tsx`
- Each page/section exports `generateMetadata()` or a static `metadata` object
- Articles: title = `${a.title} — LocReport`, description = `a.excerpt`
- `metadataBase` is set to `https://locreport.com` globally

### ISR Revalidation
- Article detail pages: `export const revalidate = 86400` (24h)
- Listing pages: `export const revalidate = 3600` (1h)

These only take effect while the page avoids Dynamic APIs — see the client-selection note above. `/articles`
and `/search` read `searchParams` and so are dynamic by nature no matter which client they use; the
homepage, article pages, `/intelligence/*`, `/fact-flow`, `/reports/monthly` and `/compass/*` are cached.
`/articles/[...slug]` has no `generateStaticParams`, so the ~1,200 article pages are generated on first
request and then cached, rather than at build time.

**Every route that writes an article or a fact must invalidate the cached pages, via `lib/revalidate.ts`.**
`revalidateArticleSurfaces({ slug?, monthlyReport? })` after publishing, editing or deleting an article;
`revalidateFactSurfaces()` when only a fact changed. Without this, a page's `revalidate` window is the
*only* thing that publishes it: approving a draft put the article on `/articles` instantly (dynamic) but
left it off the homepage and `/fact-flow` for up to an hour, and because `revalidate` is
stale-while-revalidate, the first visitor after expiry still got the stale page and merely triggered the
rebuild — so the real delay ran past the hour. Lowering the windows instead would re-open the
request-volume problem `createPublicClient()` was introduced to solve; invalidating on write keeps the
pages fully cached for anonymous traffic and still publishes immediately.

Pass the article's `slug` so its own 24h detail page turns over too — the helper routes it through
`articleHref()`, since a legacy multi-segment slug is served at a clean path and interpolating it raw
would revalidate a path nothing is cached under and fail silently. The helper deliberately does *not*
invalidate the `/intelligence/signals/[id]` or `/articles/[...slug]` dynamic segments wholesale: that
would stampede regeneration across every signal and all ~1,200 article pages. `/articles`, `/search` and
both `feed.xml` routes need nothing — they are already dynamic.

**A page's primary query must throw on error, not fall back to `[]`.** `lib/supabase/required.ts` exists for
this. Swallowing the error renders an empty page at HTTP 200 — which reads as "there is nothing here" to
both the reader and to monitoring, and which a cached page then serves until the next revalidation.
Throwing leaves the last good version in place; during a build it fails the deploy, and Vercel keeps the
previous deployment serving. Decorative extras (a sidebar rail, a fact strip) should still degrade quietly.

### Path alias
- `@/` maps to repo root (set in `tsconfig.json`)

### Slug handling
- Legacy Jekyll slugs may contain path segments (year/month/day/slug)
- `articles/[...slug]/page.tsx` handles both flat slugs and legacy multi-segment slugs
- `articleHref()` in `lib/utils.ts` always generates the canonical clean URL

### Admin auth
- Supabase email/password session
- `app/(public)/admin/layout.tsx` checks session and redirects to `/login` if unauthenticated
- Admin status determined by `api/me` checking Supabase user metadata

### Article images
- Entirely optional. `articles.image_url` set → hero image under the article header, thumbnail in the
  `/articles` cards and the homepage stream/briefing lead, OG/`twitter:image` override, `Article`
  JSON-LD `image`, and an RSS `<enclosure>`. Null → every one of those falls back to exactly the
  previous, image-less rendering.
- Set it with the `ImageDropzone` field in `/admin/articles/[id]` (published) or `/admin/drafts/[id]`
  (before approving — the value is stored on the draft and copied to the article by the approve branch
  of `/api/drafts/[id]`). There is no URL text input: the field takes a dropped file, a click-to-browse
  pick, or a clipboard paste, and stores the resulting public URL.
- **Upload path** (`components/ImageDropzone.tsx` → `/api/uploads/article-image` → Supabase Storage):
  the route authenticates the admin session, ensures the public `images` bucket exists (creating it
  with the size/MIME limits from `lib/storage.ts` if missing), and returns a signed upload URL. The
  browser then PUTs the file straight to Supabase, so image bytes never cross the serverless function
  and are not bounded by its request body limit. Objects land at
  `articles/<yyyy>/<mm>/<random>-<name>.<ext>` — unique per upload, hence the one-year cache header. The
  prefix keeps them apart from the older hand-uploaded objects sitting at the bucket root.
- Limits live in `lib/storage.ts` (10 MB; JPG/PNG/WebP/AVIF/GIF — no SVG) and are mirrored onto the
  bucket itself, so Supabase enforces them independently of the client. `supabase/migrations/20260905_article_image_bucket.sql`
  pins those limits on the bucket.
- Removing an image clears `image_url` only; the stored object is left in place, since a draft and its
  published article can point at the same file.
- Legacy rows may still hold a third-party publisher URL — those keep rendering; only new images go to
  the bucket.
- Rendered with plain `<img>`, not `next/image`: legacy sources are arbitrary publisher CDNs, and
  allowing them through the optimizer would mean opening `images.remotePatterns` to every host.
- `safeImageUrl()` in `lib/utils.ts` gates every render — http(s) or root-relative only, so a stray
  `javascript:`/`data:` value degrades to no image instead of reaching an `src`.

### LLM model
- `lib/openai.ts` sets the model (currently GPT-4o-mini) — do not hardcode model strings elsewhere

---

## Scheduled Jobs

Every scheduled task runs from **GitHub Actions** and calls a plain `CRON_SECRET`-authenticated API
route, so the scheduler is an implementation detail the route itself doesn't care about. **`vercel.json`
has no `crons` key** — Vercel only builds and serves:

| Schedule | Trigger | Purpose |
|---|---|---|
| Workdays (Mon–Fri) 10am, 1pm and 5pm Warsaw time | GitHub Actions `ingest.yml` | Two steps per run: POST `/api/scraped-sources/run` to regenerate every scrape source, then POST `/api/ingest`. Three runs a day, each scheduled at both DST offsets (`0 8/9,11/12,15/16 * * 1-5` UTC) with a runtime guard picking the live one |
| Fridays 1pm Central European time | GitHub Actions `digest.yml` | POST `/api/digest/send` — the only digest run; there is no daily cadence |
| `0 6,9,12,14,16 * * 1-5` Europe/Warsaw | **GitLab CI** (external `aparasion/rss-generator`, outside this repo) | Regenerates `https://aparasion.gitlab.io/rss-generator/rss/DeepL-Press-Releases.xml` — the one remaining feed not yet served by the embedded generator. Not part of the GitHub→Vercel setup; from ingest's side it is an ordinary feed URL |
| On-demand | `workflow_dispatch` on both GitHub workflows | Manual trigger from GitHub Actions UI |
| On-demand | `/admin` dashboard | Ingest, feed generator, and the weekly digest (dry-run preview, then confirm to send) all have manual buttons |

GitHub Actions cron is UTC-only and ignores DST, so both `digest.yml` and `ingest.yml` schedule **both** possible UTC offsets for each target local time (e.g. `0 11 * * 5` and `0 12 * * 5` for 1pm Friday) and a runtime guard decides which firing is live — the other is a no-op. This keeps each run pinned to local wall-clock time year-round instead of drifting an hour across the DST boundary.

The guard matches on the **current UTC offset** of the target zone (`TZ=... date +%z`, compared against the offset each cron entry was written for, keyed off `github.event.schedule`) rather than on the local hour. Actions can delay a scheduled run by hours under load, and a late-firing run would read the wrong local hour and skip every single time; the offset only flips twice a year, so a delayed run still resolves correctly. `workflow_dispatch` bypasses the guard entirely. `digest.yml` reads `Europe/Berlin` and `ingest.yml` reads `Europe/Warsaw` — the same CET/CEST offsets, so the two agree.

The feed generator needs no schedule of its own — it is a step inside `ingest.yml`, so it inherits that workflow's timing and DST guard.

The `CRON_SECRET` env var must be set in Vercel (Vercel attaches it as `Authorization: Bearer $CRON_SECRET` automatically on cron requests, and the API routes validate it the same way for manually-configured callers) and in the GitHub repository secrets (for the two workflows above to authenticate their own `curl` calls).

Nothing is scheduled on Vercel Cron. Its Hobby plan caps each job at once-per-day cadence and only GETs a
path, with no room for the DST guard or the two-step generator-then-ingest sequence — GitHub Actions has
both, and isn't rate-capped, so the feed generator moved into `ingest.yml` and `vercel.json` lost its
`crons` key entirely. Keep it that way: adding a Vercel cron back would re-split the schedule across two
systems.

Monthly reports are triggered manually from the admin dashboard.

---

## Deployment Notes

The Vercel project (`aggreagators/locreport`, Hobby plan) sits on a **public** GitHub repo. On
2026-09-16 a production deploy — triggered by merging a PR whose commits were pushed by the Claude
Code GitHub App rather than the account owner directly — was **BLOCKED** with *"the commit author did
not have contributing access to the project... The Hobby Plan does not support collaboration for
private repositories."* A manual "Redeploy" click from the dashboard, by the account owner, hit the
same block. The repo was private at the time; it was switched to public the same day to test whether
that was the gate. See `https://vercel.com/docs/deployments/troubleshoot-project-collaboration#team-configuration`
(Vercel's own link for this error) if it recurs. If a production deploy blocks with this message
again on a Hobby-plan project, check repo visibility first before assuming the fix requires a paid
Pro upgrade.

---

## SEO Infrastructure

- **Metadata API:** Next.js metadata exports on every public page
- **OG image:** `/public/og-image.jpg` (1200×630)
- **Sitemap:** `app/sitemap.ts` → `/sitemap.xml` (dynamic, includes all published articles)
- **Robots:** `app/robots.ts` → `/robots.txt` (blocks crawlers from admin, api, CLAUDE.md, /subscribe pages)
- **RSS:** `/feed.xml` (all articles) + `/fact-flow/feed.xml` (facts); RSS alternate declared in root layout metadata
- **301 Redirects:** `vercel.json` — preserves SEO from legacy Jekyll URLs and old route names:
  - `/market` → `/compass/locstock`
  - `/events` → `/compass/events`
  - `/tools/llm-pricing` → `/compass/llm-pricing`
  - `/tools/directory` → `/compass/directory`
  - `/research`, `/language-science` → `/articles`
  - `/language-science/:slug` → `/articles/:slug`
  - Legacy date-based paths `/articles/:year/:month/:day/:slug` → `/articles/:slug`
  - 8 specific article slug cleanups
- **GA4:** G-1KQKEEP1PL, loaded via `next/script` with `afterInteractive` strategy
- **Canonical URLs:** via `metadataBase: https://locreport.com`

---

## Common Tasks for AI Agents

### Add a new public page
1. Create `app/(public)/your-page/page.tsx`
2. Export `metadata` or `generateMetadata()` with title + description
3. Add link to `components/Nav.tsx` if it should appear in navigation

### Add a new API endpoint
1. Create `app/api/your-endpoint/route.ts`
2. Export named HTTP method handlers (`GET`, `POST`, etc.)
3. Use `createClient()` from `@/lib/supabase/server` for DB access

### Add a new signal
1. Edit `lib/signals.ts` — add to the `SIGNALS` array and update `SIGNAL_MAP`
2. No DB changes needed

### Modify LLM prompts
- Runtime editing: `/admin/prompts` UI → stored in `settings` table
- Code default: `lib/prompts.ts` → `DEFAULT_INDUSTRY_PROMPT` / `DEFAULT_EXTRACTOR_PROMPT`

### Change the design system
- Color/typography tokens: `assets/css/style.css`
- Component primitives: `components/ui/`
- Do NOT modify TailwindCSS config directly — use CSS variables

### Update static data (events, directory, LLM pricing)
- `lib/data/events.ts`, `lib/data/directory.ts`, `lib/data/llm-pricing.ts`
- These are hardcoded TypeScript arrays — edit the file directly

### Add a feed-generator scrape source (a site with no usable RSS feed)
1. `/admin/scraped-feeds` → Add feed: name, type (`html` or `rss`), the URL to scrape, optional **ingest
   keywords**, and a JSON config (CSS selectors for `html`; `contentFilter` keywords for either) — see
   `lib/feedGenerator.ts` for the selector/filter semantics
2. Click **Run now** and confirm a **non-zero item count** — `success` alone only means the fetch worked
3. Click **Add to Sources** on the feed. That creates the `rss_sources` row pointing at `/api/feeds/<name>`
   and copies the ingest keywords across. Until this step, the feed is generated but nothing reads it — the
   row badge shows `not in Sources` and a banner counts unlinked feeds

**Two kinds of keyword filter, easy to confuse:**
- `scraped_sources.keywords` — the *ingest* filter. Copied to `rss_sources.keywords` by Add to Sources, then
  applied by `/api/ingest` against each item's title + fetched article text.
- `scraped_sources.content_filter.keywords` — the *generation* filter. Drops items while the feed is being
  built, optionally fetching each article (`checkFullContent`) and memoising verdicts in `classified_links`.

---

## What NOT To Do

- Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code
- Do not add `use client` to pages that can be Server Components — prefer server-side data fetching
- Do not bypass the draft approval workflow by inserting directly to `articles` table from the ingest pipeline
- Do not hardcode the OpenAI model string — check `lib/openai.ts` for the current model reference
- Do not add cron jobs to `vercel.json` — all scheduling belongs in `.github/workflows/` (see Scheduled Jobs)
- Do not create a `/language-science` page — that route is permanently redirected to `/articles`
