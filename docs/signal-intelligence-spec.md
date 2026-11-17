# Signal Momentum & Signal Intelligence — Portable Spec

> Historical reference: the public Intelligence dashboard and Signals Tracker have been retired. Their URLs lead to a retirement notice, and new newsletter issues omit coverage-momentum tables. This document describes the former implementation. The signal taxonomy remains in use internally for article classification, topic filters and related reading.

A self-contained description of how LocReport computes and presents signal momentum and
the intelligence dashboard, written so the system can be rebuilt in another repository
without reading the original source. Stack assumptions: Next.js App Router (Server
Components), TypeScript, Recharts, a Postgres-backed client with a `.select()/.eq()`
query builder (Supabase here), CSS custom properties for theming.

---

## 1. Concept model

### 1.1 Two different "momentum" values — do not conflate them

| | Curated momentum | Observed / coverage momentum |
|---|---|---|
| Source | Hand-authored field on each signal definition (`Signal.momentum`) | Computed from article publish dates |
| Meaning | Editorial judgement: "is this trend rising in the world?" | Measurement: "is our coverage of this trend accelerating?" |
| Values | `'rising' \| 'stable' \| 'declining'` | same union |
| Changes | Only when a human edits the signals file | Every time the data recomputes (hourly ISR) |
| Where shown | Signals index cards (pill badge), signal detail header | Homepage momentum strip, dashboard panels, signal detail "Coverage trend" |

The signal detail page deliberately shows **both** — curated in the header meta row,
observed further down in the Coverage trend block. They can disagree; that is the point.

### 1.2 Signals are code, not data

Signals live in a hardcoded TypeScript array. There is no signals table, no migration to
add one. Articles reference signals by string id in an array column. This keeps signal
metadata (description, keywords, categories) versioned in git and lets the LLM classifier
be prompted with the exact list.

```ts
export interface Signal {
  id: string                     // kebab-case, used as URL segment + array element
  title: string                  // full claim sentence, e.g. "MTPE volume is declining…"
  category: 'quality' | 'operations' | 'governance' | 'market' | 'strategy'
  first_seen: string             // YYYY-MM-DD, displayed as "First tracked"
  current_status: 'supported' | 'emerging' | 'disputed'
  description: string            // one sentence, "Tracks whether/evidence that…"
  momentum: 'rising' | 'stable' | 'declining'   // CURATED
  watched_tickers: string[]      // stock symbols, displayed as mono chips
  keywords: string[]             // 8–12 phrases; feed search/classification
}

export const SIGNALS: Signal[] = [ /* 13 entries */ ]
export const SIGNAL_MAP = new Map(SIGNALS.map(s => [s.id, s]))

export const STATUS_LABEL: Record<Signal['current_status'], string> = {
  supported: 'Supported', emerging: 'Emerging', disputed: 'Disputed',
}
export const MOMENTUM_ICON: Record<Signal['momentum'], string> = {
  rising: '↑', stable: '→', declining: '↓',
}
export const CATEGORY_COLOR: Record<Signal['category'], string> = {
  quality: '#5a7d5e', operations: '#2A6FA3', governance: '#8a6b78',
  market: '#8a7a5e', strategy: '#556b65',
}
```

Title convention matters: signal titles are **falsifiable claims**, not topic labels
("Traditional TM architectures are being displaced by LLM-native approaches", not
"Translation memory"). Status/momentum only make sense against a claim.

---

## 2. Data contract

Minimum article shape the engine needs:

```
articles
  signal_ids     text[]        -- 0–2 signal ids per article (classifier-enforced cap)
  impact_score   int (1–5)     -- nullable
  published_at   timestamptz
  article_type   text          -- 'industry' | 'monthly-summary' | …
```

Impact scale (label map is duplicated in three files in the original — centralize it on a
port):

```ts
const IMPACT_LABEL = { 1:'Routine', 2:'Notable', 3:'Significant', 4:'Major', 5:'Disruptive' }
```

Two further columns exist and are **read but never written** — `signal_stance`
(`supports|mixed|contradicts|mentions`) and `signal_confidence`. They survive from a
legacy import; the LLM classifier does not populate them, so the stance breakdown on the
signal detail page reads all-zeros for new content. Either wire stance into the
classifier on a port, or drop the stance UI.

### 2.1 How `signal_ids` gets populated

An LLM classifier runs at ingest and returns strict JSON. The prompt is
anti-over-tagging, which is what keeps the momentum numbers meaningful:

- "0–2 signal IDs from the list below"
- "Only assign a signal if the article is **primarily and substantially** about that theme"
- "Do not assign a signal because the article mentions a related concept in passing"
- "Assign 0 signals if no signal fits the article's core subject well"
- "Assign at most 1 signal in most cases; use 2 only when two signals are both central"

The returned ids are then filtered against a `Set` of valid ids before insert — never
trust the model to stay inside the enum. On parse failure the fallback is
`{ impact_score: null, time_horizon: null, signal_ids: [], … }`, never a guess.

---

## 3. The computation engine

One module (`lib/intelligence.ts`). One database round-trip feeds every chart.

### 3.1 ISO-week bucketing

Weeks are keyed by their **UTC Monday** as `YYYY-MM-DD`. All date math is UTC to stay
deployment-timezone-independent.

```ts
function isoWeekMonday(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay() || 7          // Sunday(0) → 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function weekMondays(weeks: number, end = new Date()): string[] {
  const mondays: string[] = []
  const cursor = new Date(isoWeekMonday(end) + 'T00:00:00Z')
  for (let i = 0; i < weeks; i++) {
    mondays.unshift(cursor.toISOString().slice(0, 10))   // unshift → chronological
    cursor.setUTCDate(cursor.getUTCDate() - 7)
  }
  return mondays
}
```

`weekMondays` produces the **full** week axis including empty weeks. This is essential:
sparklines must render zero-weeks as zeros, not skip them, or a gap in coverage looks
like a plateau.

Standalone helper for one-off series (used by the signal detail page):

```ts
export function weeklySeries(dates: string[], weeks = 16): SignalWeekPoint[] {
  const mondays = weekMondays(weeks)
  const counts = new Map<string, number>()
  for (const iso of dates) {
    const week = isoWeekMonday(new Date(iso))
    counts.set(week, (counts.get(week) ?? 0) + 1)
  }
  return mondays.map(week => ({ week, count: counts.get(week) ?? 0 }))
}
```

### 3.2 The momentum rule

**Trailing 8 weeks vs the 8 weeks before, with a noise floor.**

```ts
export function computeMomentum(recentCount: number, priorCount: number)
  : 'rising' | 'stable' | 'declining' {
  if (recentCount + priorCount < 4) return 'stable'    // too little data to call
  if (recentCount >= priorCount * 1.25) return 'rising'
  if (recentCount <= priorCount * 0.75) return 'declining'
  return 'stable'
}
```

Three design decisions worth preserving:

1. **The `< 4` floor.** Without it, 1 article vs 0 reads as infinite growth. Sparse signals
   report `stable` rather than a fake trend.
2. **±25% dead band.** 5→6 articles is noise; only a quarter-magnitude change earns a
   direction.
3. **`priorCount === 0` with `recent ≥ 4`** falls through `recent >= 0 * 1.25` → `rising`.
   That is intended: brand-new coverage of a dormant signal *is* rising.

The window pair (8/8) and the thresholds are the two knobs to tune per publication cadence.
A weekly publication should widen to 12/12; a high-volume daily could narrow to 4/4.

### 3.3 The single aggregate query

```ts
export async function getIntelligenceData(supabase): Promise<IntelligenceData> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

  const { data: articles } = await supabase
    .from('articles')
    .select('signal_ids, impact_score, published_at')
    .eq('article_type', 'industry')
    .gte('published_at', cutoff.toISOString())
  // …single pass over rows, bucketing into all four outputs…
}
```

Three narrow columns, twelve months, one query. Everything below is computed in a single
JS pass — no per-signal query, no N+1. With 13 signals × 16 weeks × 12 months this stays
well under a millisecond, so the page cost is the one round-trip.

Returned shape:

```ts
interface SignalSeries {
  signalId: string
  weekly: { week: string; count: number }[]   // 16 points, chronological, zero-filled
  total: number                                // 12-month total for this signal
  observedMomentum: 'rising' | 'stable' | 'declining'
  recentCount: number                          // trailing 8 weeks
  priorCount: number                           // the 8 before
}

interface IntelligenceData {
  signalSeries: SignalSeries[]                 // one per signal, in SIGNALS order
  monthlyRows: { month: string; [signalId: string]: string | number }[]  // 12 rows
  topSignalIds: string[]                       // 5 busiest by 12-month total
  impactBuckets: { impact: number; label: string; recent: number; prior: number }[]
}
```

Bucketing rules inside the single pass:

- **Weekly** — 16 UTC-Monday buckets per signal. `mondaySet.has(week)` guards, so the
  365-day fetch window silently drops anything older than 16 weeks from the sparkline.
- **Monthly** — 12 `YYYY-MM` buckets per signal, built from
  `new Date(Date.UTC(y, m - i, 1))` counting back 11→0. Month key is just
  `published_at.slice(0, 7)` — string slicing, no parsing.
- **Totals** — counted across the whole 365-day window, independent of the 16-week and
  12-month gates, so `total` can exceed the sum of either series.
- **Recent/prior split** — `mondays.slice(8)` is the trailing 8 weeks,
  `mondays.slice(0, 8)` the prior 8. Held as `Set`s for O(1) membership.
- **Unknown ids skipped** — `if (!weeklyBySignal.has(sid)) continue` drops references to
  retired signals rather than crashing.
- **Impact distribution** — trailing 90 days vs the 90 before (`d90`/`d180` boundaries),
  `else if` so the windows never double-count.
- **`monthlyRows` are wide, not long** — one object per month with a key per top signal
  (`{ month: '2026-08', 'multilingual-llm-gap': 4, … }`). That is Recharts' preferred
  shape if you ever want them on one axis; the current UI splits them into small multiples.

### 3.4 Short labels

Full signal titles are sentences and will not fit in a chart panel. A parallel display-name
map is required:

```ts
export const SIGNAL_SHORT_LABEL: Record<string, string> = {
  'quality-gap-closure': 'Quality gap closure',
  'multilingual-llm-gap': 'Multilingual LLM gap',
  // …one per signal
}
export function signalShortLabel(id: string): string {
  return SIGNAL_SHORT_LABEL[id] ?? id.replace(/-/g, ' ')   // graceful de-kebab fallback
}
```

---

## 4. Presentation surfaces

Four surfaces consume the engine. All are Server Components that `await` the data and pass
plain props into thin `'use client'` chart wrappers. `export const revalidate = 3600`
(1 hour ISR) on every one.

### 4.1 Homepage — momentum strip

Compact 4-tile strip. Selection logic prioritises *direction* over *volume*:

```ts
const intel = await getIntelligenceData(supabase)
const rising = intel.signalSeries.filter(s => s.observedMomentum === 'rising')
const filler = intel.signalSeries
  .filter(s => s.observedMomentum !== 'rising')
  .sort((a, b) => b.recentCount - a.recentCount)
const momentumItems = [...rising.sort((a, b) => b.recentCount - a.recentCount), ...filler]
  .slice(0, 4)
  .filter(s => s.recentCount > 0)       // never show a dead signal
  .map(s => ({ id: s.signalId, label: signalShortLabel(s.signalId),
               momentum: s.observedMomentum, recentCount: s.recentCount, weekly: s.weekly }))
```

Rising signals first (busiest rising first), then busiest of the rest as filler, cap at 4,
and drop anything with zero recent coverage. `.filter` runs **after** `.slice(4)`, so the
strip can render fewer than four tiles — and `MomentumStrip` returns `null` on an empty
array rather than an empty box.

Recharts is kept out of the homepage's initial bundle:

```tsx
const SignalSparkline = dynamic(
  () => import('@/components/SignalSparkline').then(m => m.SignalSparkline),
  { ssr: false, loading: () => <div style={{ height: 28 }} /> }
)
```

The `loading` placeholder reserves the exact final height — no layout shift when the chart
hydrates.

Markup and copy:

```tsx
<section className="momentum-strip" aria-label="Signal momentum this week">
  <div className="momentum-strip__head">
    <p className="momentum-strip__title">Signal momentum</p>
    <Link href="/intelligence/signals" className="sidebar-widget__more">All signals →</Link>
  </div>
  <div className="momentum-strip__grid">
    {items.map(item => (
      <Link key={item.id} href={`/intelligence/signals/${item.id}`} className="momentum-strip__item">
        <span className="momentum-strip__label">{item.label}</span>
        <span className="momentum-strip__meta">
          {GLYPH[item.momentum]} {item.momentum} · {item.recentCount} article
          {item.recentCount !== 1 ? 's' : ''} / 8 wk
        </span>
        <SignalSparkline data={item.weekly} height={28} />
      </Link>
    ))}
  </div>
</section>
```

Reads as: `↑ rising · 7 articles / 8 wk`. Whole tile is the link target.

### 4.2 Intelligence dashboard (`/intelligence`)

Four sections, top to bottom:

**Stat cards** — Articles Tracked · High Impact (4–5) · Active Signals · This Month.
Computed from a second, unfiltered `select('impact_score, published_at')` run in
`Promise.all` alongside `getIntelligenceData` (all-time counts, not the 365-day window).

**Signal coverage momentum** — small multiples, one panel per top-5 signal:

> Monthly article volume for the five most-covered signals over the last 12 months.
> Momentum compares the trailing 8 weeks of coverage with the 8 before.

Stating the window in the subtitle is what makes the badge legible. Each panel:
short label + momentum badge, `{total} articles · 12 mo`, then a 96px area chart.

```tsx
const maxCount = Math.max(1, ...panels.flatMap(p => p.monthly.map(d => d.count)))
// …per panel…
<YAxis hide domain={[0, maxCount]} />
```

**A shared Y domain across all five panels is the load-bearing detail** — small multiples
with independent auto-scaled axes are actively misleading, because a signal with 2 articles
draws the same mountain as one with 20. The `Math.max(1, …)` guards an all-zero dataset.

Other panel specifics: `type="monotone"` area, `stroke="var(--accent)"`, `strokeWidth={2}`,
`isAnimationActive={false}` (charts are informational, not entrances), X axis shows only
first and last month (`ticks={[first, last]}`, `interval="preserveStartEnd"`) formatted as
short month names in UTC, and a per-panel empty state — `No coverage yet in this window` —
instead of a flat zero line. All panels use the same accent colour; identity comes from the
panel title, not colour discrimination.

**Impact distribution** — grouped bar chart, five impact labels × two series:

> How coverage skews across impact levels — the last 90 days against the 90 before.

`Bar dataKey="recent" name="Last 90 days" fill="var(--accent)"` and
`dataKey="prior" name="Prior 90 days" fill="var(--viz-neutral)"`. Two series only: brand
accent vs neutral grey — no second hue. `radius={[4,4,0,0]}`, `maxBarSize={36}`,
`barGap={2}`, horizontal-only gridlines (`<CartesianGrid vertical={false}>`). Whole-chart
empty state when every bucket is zero.

Then two link cards (Signals tracker / High Impact), a subscribe band, and a standing
data-provenance disclaimer stating the intelligence is derived from published coverage
rather than primary research. Ship that disclaimer with the feature — it is what keeps
"momentum" honest.

`loading.tsx` provides a skeleton mirroring the layout: title, subtitle, 4-up grid at 90px,
one 280px block.

### 4.3 Signals index (`/intelligence/signals`)

Header with four stat chips (total / supported / emerging / disputed, counted from the
`SIGNALS` array), then a 3-column card grid — 2 columns under 960px, 1 under 580px.

Each card: category eyebrow · status badge + **curated** momentum pill · full title ·
description · 16-week sparkline · article count + CTA. Article counts here come from a
separate `select('signal_ids').neq('article_type','monthly-summary')` — all-time, whereas
the sparkline is the 365-day/16-week series. Two different denominators on one card;
worth unifying on a port.

### 4.4 Signal detail (`/intelligence/signals/[id]`)

`generateStaticParams()` pre-renders one page per signal id from `SIGNAL_MAP.keys()`;
`notFound()` on an unknown id. Sections in order:

1. **Breadcrumbs** — Intelligence › Signals › truncated title (50 chars + `…`).
2. **Header** — status badge, `{MOMENTUM_ICON[m]} {m} momentum` (curated), category chip
   tinted via `color-mix(in srgb, {CATEGORY_COLOR} 10%, transparent)`, `First tracked: {date}`,
   full title, description, and `Watching:` ticker chips in mono.
3. **Stats bar** — Total articles / Supports / Mixed / Contradicts, each with a coloured
   left border (accent / green / amber / red). Stance counts come from `signal_stance`
   with an `else → mentions` fallback for unrecognised values.
4. **Coverage trend** — the observed momentum, computed inline from this signal's own
   article list rather than from `getIntelligenceData`:

```tsx
const weekly = weeklySeries(articles.map(a => a.published_at))   // 16 weeks
const recent = weekly.slice(8).reduce((s, w) => s + w.count, 0)
const prior  = weekly.slice(0, 8).reduce((s, w) => s + w.count, 0)
const momentum = computeMomentum(recent, prior)
```

> Weekly article volume over the last 16 weeks — coverage momentum is **{momentum}**
> ({recent} articles in the trailing 8 weeks vs {prior} before).

Always print the raw counts next to the verdict. `rising` alone is unfalsifiable;
`rising (7 vs 3)` is a claim the reader can check. The 56px sparkline sits below it as
reinforcement, `aria-hidden`.

5. **Related signals** — co-occurrence. Fetch `signal_ids` for every article containing
   this signal, count every *other* id that appears, sort desc, take 5, render as
   "{n} shared articles". A cheap graph edge with no extra schema.
6. **Evidence list** — every article referencing the signal, newest first: title link,
   date, publisher, impact badge (only when `impact_score >= 2` — routine coverage gets no
   badge), stance dot, 180-char truncated excerpt. Empty state:
   `No articles reference this signal yet.`

### 4.5 The sparkline primitive

```tsx
'use client'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

export function SignalSparkline({ data, height = 36 }: { data: SparkPoint[]; height?: number }) {
  const flat = data.every(d => d.count === 0)
  return (
    <div className="signal-sparkline" style={{ height }} aria-hidden="true">
      {flat ? (
        <span className="signal-sparkline__flat" />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <Area type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={1.5}
                  fill="var(--accent-soft, rgba(53, 80, 245, 0.12))" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
```

Four things carry the design: no axes/grid/tooltip (shape only); an all-zero series
degrades to a 1.5px hairline rather than a Recharts error or an empty box; `aria-hidden`
because the numbers are always in adjacent text; height driven by prop so one component
serves 28px strip / 30px card / 56px detail.

---

## 5. Styling contract

### 5.1 Tokens required

```css
--accent          /* every chart stroke and bar */
--accent-soft     /* area fills, tooltip cursor; sparkline has a literal fallback */
--viz-neutral     /* the "prior period" series — must be defined per theme */
--surface --bg-secondary --border --hairline --text --muted
--radius-md --radius-lg --space-1 … --space-16 --font-display
```

`--viz-neutral` is the one token specific to this feature (`#9A9DA6` light / `#77797F`
dark). Define it before porting the impact chart. Chart colours are passed to Recharts as
`var(--…)` strings, so a theme switch repaints without a re-render.

### 5.2 Semantic colour scales

Momentum, status, and stance each get their own scale, all with dark-mode overrides:

```css
/* momentum — glyph-only, chart panels */
.momentum-panel__badge--rising    { color: #16a34a; }
.momentum-panel__badge--stable    { color: var(--muted); }
.momentum-panel__badge--declining { color: #dc2626; }
[data-theme="dark"] .momentum-panel__badge--rising    { color: #4ade80; }
[data-theme="dark"] .momentum-panel__badge--declining { color: #f87171; }

/* momentum — pill badge, index cards */
.momentum-badge { display:inline-flex; align-items:center; justify-content:center;
  width:1.25rem; height:1.25rem; border-radius:50%; font-size:.7rem; font-weight:700;
  line-height:1; flex-shrink:0; }
.momentum-badge--pill { width:auto; height:auto; border-radius:100px; padding:3px 8px;
  font-size:.65rem; letter-spacing:.04em; text-transform:uppercase; }
.momentum-badge--rising    { background:#e6f4ea; color:#2e7d32; }
.momentum-badge--declining { background:#fdecea; color:#c62828; }
.momentum-badge--stable    { background:var(--border); color:var(--muted); }
[data-theme="dark"] .momentum-badge--rising    { background:rgba(46,125,50,.2);  color:#81c784; }
[data-theme="dark"] .momentum-badge--declining { background:rgba(198,40,40,.2);  color:#ef9a9a; }
[data-theme="dark"] .momentum-badge--stable    { background:rgba(255,255,255,.06); color:var(--muted); }

/* status — muted/desaturated on purpose, so it reads as metadata not alarm */
.status-badge { display:inline-block; font-size:.65rem; font-weight:700; letter-spacing:.06em;
  text-transform:uppercase; padding:4px 10px; border-radius:100px; vertical-align:middle; }
.status-badge--supported  { background:#e6ece7; color:#4d6650; }
.status-badge--emerging   { background:#eef0f2; color:#5a6270; }
.status-badge--challenged { background:#fee2e2; color:#b91c1c; }   /* NB: class name ≠ status value */
```

Note the mismatch: status value `disputed` maps to CSS class `--challenged` via an explicit
`STATUS_CLASS` lookup on the detail page, while the index page interpolates the raw value
(`status-badge--${signal.current_status}`) and therefore hits an **undefined class** for
disputed signals. Fix on port: rename the CSS to `--disputed` and drop the lookup.

### 5.3 Layout blocks

```css
.momentum-grid  { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px,1fr));
                  gap:var(--space-3); }
.momentum-panel { display:flex; flex-direction:column; gap:4px; padding:var(--space-4);
                  background:var(--surface); border:1px solid var(--border);
                  border-radius:var(--radius-lg); transition:border-color .15s; }
.momentum-panel:hover        { border-color:var(--accent); }
.momentum-panel__head        { display:flex; align-items:baseline; justify-content:space-between;
                               gap:var(--space-2); }
.momentum-panel__label       { font-size:.85rem; font-weight:700; color:var(--text); line-height:1.3; }
.momentum-panel__total       { font-size:.72rem; color:var(--muted); margin:0; }
.momentum-panel__chart       { height:96px; margin-top:var(--space-1); }
.momentum-panel__empty       { font-size:.78rem; color:var(--muted); margin:var(--space-3) 0; }

.impact-chart   { background:var(--surface); border:1px solid var(--border);
                  border-radius:var(--radius-lg); padding:var(--space-4) var(--space-4) var(--space-2); }

.signal-sparkline       { width:100%; }
.signal-sparkline__flat { display:block; height:1.5px; margin-top:17px; background:var(--border); }

.momentum-strip__grid  { display:grid; grid-template-columns:repeat(auto-fill, minmax(170px,1fr));
                         gap:var(--space-3); }
.momentum-strip__item  { display:flex; flex-direction:column; gap:2px; padding:var(--space-3);
                         background:var(--surface); border:1px solid var(--border);
                         border-radius:var(--radius-md); transition:border-color .15s; }
.momentum-strip__title { font-size:.72rem; font-weight:700; text-transform:uppercase;
                         letter-spacing:.14em; color:var(--accent); margin:0; }
.momentum-strip__label { font-size:.76rem; font-weight:700; color:var(--text); line-height:1.3; }
.momentum-strip__meta  { font-size:.68rem; color:var(--muted); }
```

`auto-fill` + `minmax` everywhere — the panel grids never need media queries; only the
signals index card grid uses explicit breakpoints (960px → 2 col, 580px → 1 col).

---

## 6. Rebuild checklist

1. `lib/signals.ts` — Signal interface, the array, `SIGNAL_MAP`, and the three label maps.
   Write titles as claims.
2. `lib/intelligence.ts` — `isoWeekMonday`, `weekMondays`, `weeklySeries`, `computeMomentum`,
   `SIGNAL_SHORT_LABEL`/`signalShortLabel`, `getIntelligenceData`.
3. Classifier prompt with the anti-over-tagging rules, id whitelist filtering, and a
   null-safe fallback.
4. `SignalSparkline` (client) — height prop, flat-line degradation, `aria-hidden`.
5. `MomentumStrip` (client) — dynamic-import the sparkline, `null` on empty.
6. `SignalMomentumChart` (client) — small multiples with a **shared Y domain**.
7. `ImpactDistributionChart` (client) — grouped bars, accent vs `--viz-neutral`.
8. Server pages: dashboard, signals index, signal detail. `revalidate = 3600` on each;
   `generateStaticParams` on the detail route.
9. CSS: `--viz-neutral` + the blocks in §5, with dark-mode pairs for every semantic colour.

### Gotchas carried over from the original

- **Arrow-glyph maps are duplicated in four files** (`MOMENTUM_ICON` in signals.ts, `GLYPH`
  in MomentumStrip, `MOMENTUM_LABEL` in signals index, `MOMENTUM_GLYPH` in the chart).
  Export one map and reuse it.
- **`IMPACT_LABEL` is duplicated in three files.** Same fix.
- **Inconsistent article-type filters.** `getIntelligenceData` uses
  `.eq('article_type','industry')`; the index-card counts and detail-page evidence use
  `.neq('article_type','monthly-summary')`. With a third type present these disagree.
  Pick one predicate and share it.
- **`status-badge--disputed`** does not exist; see §5.2.
- **`signal_stance` is never written** by the pipeline; the stance UI reads as zeros.
- **Momentum on the detail page is recomputed** from that page's own query instead of
  reusing `getIntelligenceData`. Results agree only while both filters agree — see above.
- **All date math must be UTC.** Mixing local-time parsing into `isoWeekMonday` shifts
  bucket boundaries by a day and makes momentum flicker with deployment region.
