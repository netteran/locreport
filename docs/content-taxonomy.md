# LocReport content taxonomy

| Format | Public archive | Editorial scope | Reading time |
| --- | --- | --- | --- |
| Industry Brief | `/briefs/` | One appointment, launch, event, or other development in 200–450 words. | 1–2 min |
| Loc Analysis | `/analysis/` | Evidence synthesis, technical breakdowns, or strategic commentary focused on market implications. Aim for 600–1,500+ words. | 4–8 min |
| Monthly Report | `/reports/` | Recurring evidence-backed roundups, benchmarks, and datasets. | 6+ min |

## Editorial review

Choose **Editorial format** in Compose, Direct entry, or Draft review. The published article editor can correct a story’s classification. Use the monthly reporting workspace to create reports and preserve their evidence and coverage dates.

A brief needs one original source URL. Credit the named publisher, spokesperson, or document in the lead with an inline link. Add a **Why this matters** heading and two or three specific implications. End on a separate line using the following Markdown.

```markdown
*Sources: [Publisher or document name](https://publisher.example/release)*
```

For analysis, put citations at the claims they support. Use natural anchor text, for example **Slator’s latest market report**. Reserve lists at the end for official multi-page documents. Editors should verify that a document is official and that the linked material supports the claim.

## Routing and rollout

- Apply `20261130_content_taxonomy.sql` to Supabase before building or deploying this version. The migration keeps the stored slugs and article copy intact. Existing monthly reports become reports. Single-source, brief-length stories with saved takeaways become briefs. The rest become analysis. Editors can adjust those classifications after review.
- The public article index is the source for canonical slugs, feed order, and sitemap entries. New public paths always end in a slash. Historical dated URLs, known aliases, and `/articles/[slug]` issue a 301 to the recorded format. `/articles/` and `/page/1/` issue a 301 to the homepage.
- The home feed contains 12 published stories per page. Filter pills switch the displayed format without adding parameters to the public URL. Unfiltered Load More updates the URL to the current page while keeping previously loaded stories on screen. Each page URL serves its own slice with an HTML link to the next slice when one exists. The annual report remains available in the reports archive.
- Validate the sitemap, homepage canonical, standalone page 2 canonical, one article in each format, and their legacy redirects after deployment. Existing RSS item IDs stay stable for subscribers while the item links use the new paths.

## Files changed

Paths in braces list the individual files or subdirectories in each group.

| Area | Files |
| --- | --- |
| Database and types | `supabase/migrations/20261130_content_taxonomy.sql`, `lib/types.ts`, `lib/contentTaxonomy.ts` |
| Routes and indexing | `middleware.ts`, `next.config.ts`, `vercel.json`, `app/sitemap.ts`, `lib/{articleLookup,legacyArticleSlugs,seo,reports,revalidate}.ts` |
| Public archives and reading | `app/(stories)/{layout.tsx,reading.css,briefs/page.tsx,briefs/[slug]/page.tsx,analysis/page.tsx,analysis/[slug]/page.tsx,reports/page.tsx,reports/[slug]/page.tsx,reports/2026-annual-global-market-report/page.tsx}`, `components/{PublicArticle,ContentArchive,ContentBadge,ReadingProgress}.tsx` |
| Replaced legacy routes | `app/(public)/articles/{page.tsx,loading.tsx,ArticlesFilter.tsx,[...slug]/page.tsx,[...slug]/loading.tsx,[...slug]/reading.css}`, `components/ArticleCard.tsx`. The two existing report pages moved from `app/(public)/reports/` to `app/(stories)/reports/`. |
| Homepage and pagination | `app/(public)/{page.tsx,homepage.css,public-theme.css,layout.tsx}`, `app/(stories)/page/[num]/page.tsx`, `app/api/content/feed/route.ts`, `components/{ContentFeed,Nav}.tsx`, `lib/{contentFeed,feedPagination}.ts` |
| Public link producers | `app/(public)/{about,directory/[slug],fact-flow,intelligence,search,subscribe/confirm}/page.tsx`, `app/(public)/{feed.xml,fact-flow/feed.xml}/route.ts`, `app/not-found.tsx`, `lib/{articleReferences,companyArticles,publicFacts,monthlyBriefing,utils}.ts`, `lib/email/{digest,edition,period,templates}.ts`, `components/{MonthlyReportEvidence,PodcastEpisodes}.tsx` |
| Editorial screens | `app/(public)/admin/{articles/[id],compose,direct,drafts/[id],reports}/page.tsx`, `app/(public)/admin/fact-flow/FactFlowAdmin.tsx`, `components/{AdminAreaNav,AdminOperations,ContentTypeField}.tsx` |
| Editorial APIs and validation | `app/api/{admin/fix-report-links,articles,articles/[id],compose,compositions/[id]/generate,direct,drafts,drafts/[id],drafts/[id]/rerun,facts,monthly-report,podcasts/[id]/episodes,reports/image}/route.ts`, `lib/{adminFacts,deleteArticles,editorialProtocol,prompts,publish,synthesis}.ts` |
| Verification | `tests/{adminFacts,briefingDisplay,contentTaxonomy,factEditing,monthlyBriefing,newsletterCompany,optionalCitations,publicFacts,research.database,singleSourceGeneration,weeklyEdition,weeklyNote}.test.cjs`, `tests/{editorial,reading-layout,research,taxonomy}.browser.cjs`, `tests/fixtures/{supabase,typescript}.cjs` |
| Editorial and rollout notes | `docs/content-taxonomy.md` |
