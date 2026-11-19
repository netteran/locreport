'use client'
import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IngestButton, type IngestResult } from '@/components/IngestButton'
import { IngestDetails } from '@/components/IngestDetails'
import type { IngestSourceResult } from '@/lib/ingestReport'
import { BackfillEmbeddingsButton } from '@/components/BackfillEmbeddingsButton'
import { RunFeedButton, type RunFeedResult } from '@/components/RunFeedButton'
import { researchRunSummary } from '@/lib/manualResearch'
import { monthlyPeriod } from '@/lib/monthlyBriefing'

type Confirm = 'ingest' | 'monthly' | 'monthly-force' | null
type RowKey = 'ingest' | 'feeds' | 'monthly' | 'digest' | 'facts' | 'quotes' | 'pricing'

// One row of the action list. The title doubles as the toggle for its
// explanation; a short summary keeps the resting state easy to scan;
// anything passed as children (confirmation panels, result messages)
// renders below the head and is never hidden behind the toggle.
function ActionRow({ title, summary, description, controls, controlsClass, children }: {
  title: string
  summary: string
  description: string
  controls: ReactNode
  controlsClass?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const descriptionId = useId()
  return (
    <div className="admin-action">
      <div className="admin-action__head">
        <div className="admin-action__intro">
          <button
            type="button"
            className="admin-action__title"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls={descriptionId}
          >
            <span className="admin-action__chevron" aria-hidden="true">›</span>
            {title}
          </button>
          <p className="admin-action__summary">{summary}</p>
        </div>
        <div className={`admin-action__controls${controlsClass ? ` ${controlsClass}` : ''}`}>{controls}</div>
      </div>
      <p id={descriptionId} hidden={!open} className="admin-action__desc">{description}</p>
      {children}
    </div>
  )
}

function ActionPanel({ tone = 'info', text, actions }: {
  tone?: 'info' | 'warn'
  text: ReactNode
  actions: ReactNode
}) {
  return (
    <div className={`admin-action__panel${tone === 'warn' ? ' admin-action__panel--warn' : ''}`}>
      <p className="admin-action__panel-text">{text}</p>
      <div className="admin-action__panel-actions">{actions}</div>
    </div>
  )
}

export function AdminOperations({ area }: { area: 'daily' | 'monthly' | 'facts' | 'articles' }) {
  const [reportStart, setReportStart] = useState(() => monthlyPeriod().startDay)
  const [reportEnd, setReportEnd] = useState(() => monthlyPeriod().endDay)
  const [monthlyRunning, setMonthlyRunning] = useState(false)
  const [monthlyDraftId, setMonthlyDraftId] = useState<string | null>(null)
  const [quotesRunning, setQuotesRunning] = useState(false)
  const [pricingRunning, setPricingRunning] = useState(false)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillSlug, setBackfillSlug] = useState('')
  const [backfillAllRunning, setBackfillAllRunning] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [ingestSources, setIngestSources] = useState<IngestSourceResult[] | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error'>('ok')
  const [messageFor, setMessageFor] = useState<RowKey | null>(null)

  // Results land in the row that produced them — in a compact list a single
  // shared status line would sit too far from the button that was clicked.
  function flash(row: RowKey, text: string, type: 'ok' | 'error' = 'ok') {
    setMessage(text)
    setMessageType(type)
    setMessageFor(text ? row : null)
  }

  function clearFlash() {
    setMessage('')
    setMessageFor(null)
  }

  function status(row: RowKey) {
    if (!message || messageFor !== row) return null
    return (
      <p role={messageType === 'error' ? 'alert' : 'status'} className={`admin-action__status${messageType === 'error' ? ' admin-action__status--error' : ''}`}>
        {message}
      </p>
    )
  }

  async function runMonthly(force = false) {
    setConfirm(null)
    setMonthlyRunning(true)
    setMonthlyDraftId(null)
    clearFlash()
    const res = await fetch('/api/monthly-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force, start_date: reportStart, end_date: reportEnd }),
    })
    const data = await res.json()
    if (data.existing_draft_id) {
      setMonthlyDraftId(data.existing_draft_id)
      setMonthlyRunning(false)
      flash('monthly', 'A monthly briefing draft is already awaiting review.', 'error')
      return
    }
    if (res.ok) setMonthlyDraftId(data.draft_id)
    if (res.status === 409 && !force) {
      // Briefing already exists — ask to force
      setMonthlyRunning(false)
      setConfirm('monthly-force')
      flash('monthly', `A monthly briefing for this period already exists${data.existing_id ? ` (ID: ${data.existing_id})` : ''}.`, 'error')
      return
    }
    flash(
      'monthly',
      res.ok
        ? `Monthly briefing draft saved: "${data.title}" — ${data.article_count} analyses, ${data.fact_count ?? 0} facts and ${data.source_count ?? 0} sources assessed.`
        : (data.error ?? 'Generation failed.'),
      res.ok ? 'ok' : 'error',
    )
    setMonthlyRunning(false)
  }

  async function backfillFacts() {
    const slug = backfillSlug.trim()
    if (!slug) return
    setBackfillRunning(true)
    clearFlash()
    const res = await fetch('/api/admin/backfill-facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
    const data = await res.json()
    flash(
      'facts',
      res.ok
        ? `Published a Fact Flow fact for "${slug}": ${data.fact ?? ''}`
        : (data.error ?? data.message ?? 'Backfill failed.'),
      res.ok ? 'ok' : 'error',
    )
    if (res.ok) setBackfillSlug('')
    setBackfillRunning(false)
  }

  // Walks every article that has no Fact Flow entry, newest first, in batches.
  // Each fact is backdated to its article's publication date, so this fills the
  // gaps in the stream rather than stacking old news on top of it.
  async function backfillAllFacts() {
    setBackfillAllRunning(true)
    clearFlash()
    let created = 0
    let remaining: number | null = null
    try {
      for (let round = 0; round < 40; round++) {
        const res = await fetch('/api/admin/backfill-facts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true, limit: 10 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        created += data.created ?? 0
        remaining = data.remaining ?? 0
        flash('facts', `Backfilling… ${created} published, ${remaining} to go.`, 'ok')
        if (!data.processed || remaining === 0) break
      }
      flash(
        'facts',
        `Backfill finished — ${created} article${created === 1 ? '' : 's'} given a fact${remaining ? `, ${remaining} still without one` : ''}.`,
        'ok',
      )
    } catch (err) {
      flash('facts', err instanceof Error ? err.message : 'Backfill failed.', 'error')
    }
    setBackfillAllRunning(false)
  }

  async function refreshQuotes() {
    setQuotesRunning(true)
    clearFlash()
    const res = await fetch('/api/market-quotes', { method: 'POST' })
    const data = await res.json()
    flash(
      'quotes',
      res.ok ? `Market quotes updated: ${data.updated} tickers (${data.failed} failed).` : (data.error ?? 'Update failed.'),
      res.ok ? 'ok' : 'error',
    )
    setQuotesRunning(false)
  }

  async function refreshPricing() {
    setPricingRunning(true)
    clearFlash()
    const res = await fetch('/api/llm-pricing', { method: 'POST' })
    const data = await res.json()
    flash(
      'pricing',
      res.ok ? `LLM pricing updated: ${data.updated} models (${data.failed} failed).` : (data.error ?? 'Update failed.'),
      res.ok ? 'ok' : 'error',
    )
    setPricingRunning(false)
  }

  const reportLabel = `${reportStart} to ${reportEnd}`
  const invalidReportRange = !reportStart || !reportEnd || reportStart > reportEnd

  return <div className="admin-actions">
    {area === 'daily' && <>
          <ActionRow
            title="Run feed generator"
            summary="Refresh all active generated feeds before collection."
            description="Regenerates every active generated feed — HTML listing pages read via CSS selectors, or existing feeds re-filtered by keyword — and republishes each at /api/feeds/<name>. Runs automatically at the start of every scheduled ingest run (10am/1pm/5pm Warsaw, workdays), so ingest always reads freshly generated XML. A feed is only ingested once it has been added to Sources; manage feeds, see per-feed status and add them to Sources at /admin/scraped-feeds."
            controls={
              <RunFeedButton
                label="Run"
                onDone={(result: RunFeedResult) => flash(
                  'feeds',
                  `${result.succeeded}/${result.processed} source${result.processed !== 1 ? 's' : ''} refreshed${result.failed ? `, ${result.failed} failed` : ''}.`,
                  result.failed ? 'error' : 'ok',
                )}
              />
            }
          >
            {status('feeds')}
          </ActionRow>
          <ActionRow
            title="Run ingest"
            summary="Collect sources, process Fact Flow and refresh article suggestions."
            description="Collects RSS source evidence, matches events, creates Fact Flow items, publishes eligible facts from sources with Auto enabled, and refreshes article suggestions. Keep this page open until processing finishes. The same stages run at 10am, 1pm and 5pm Warsaw time on weekdays. Full article generation and publication are manual from Source candidates."
            controls={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setConfirm('ingest'); setIngestSources(null); clearFlash() }}
                disabled={confirm === 'ingest'}
              >
                Run
              </Button>
            }
          >
            {confirm === 'ingest' && (
              <ActionPanel
                text="Collect source evidence, process Fact Flow and refresh article suggestions? Eligible facts from sources with Auto enabled will publish."
                actions={
                  <>
                    <IngestButton
                      label="Confirm"
                      onDone={(result: IngestResult) => {
                        setIngestSources(result.source_results ?? null)
                        setConfirm(null)
                        const issues = [...result.errors, ...result.research.errors]
                        flash('ingest', `+${result.processed} source candidate${result.processed !== 1 ? 's' : ''} collected, ${result.skipped} skipped. ${researchRunSummary(result.research)} ${issues.join('; ')}`.trim(), issues.length ? 'error' : 'ok')
                      }}
                    />
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  </>
                }
              />
            )}
            {status('ingest')}
            {ingestSources && <IngestDetails sources={ingestSources} />}
          </ActionRow>
          <ActionRow
            title="Refresh market quotes"
            summary="Update cached LocStock prices and recent history."
            description="Pulls the latest price and 30-day history for every LocStock ticker from Yahoo Finance and caches them for /compass/locstock. Nothing schedules this — point a daily cron-job.org job at POST /api/market-quotes to automate it."
            controls={
              <Button size="sm" variant="secondary" onClick={refreshQuotes} disabled={quotesRunning}>
                {quotesRunning ? 'Refreshing…' : 'Refresh'}
              </Button>
            }
          >
            {status('quotes')}
          </ActionRow>
          <ActionRow
            title="Refresh LLM pricing"
            summary="Update model prices and record pricing changes."
            description="Pulls current per-token pricing for every tracked model from OpenRouter, updates the /compass/llm-pricing simulator, and writes a history row for any model whose price moved. Nothing schedules this — point a daily cron-job.org job at POST /api/llm-pricing to automate it."
            controls={
              <Button size="sm" variant="secondary" onClick={refreshPricing} disabled={pricingRunning}>
                {pricingRunning ? 'Refreshing…' : 'Refresh'}
              </Button>
            }
          >
            {status('pricing')}
          </ActionRow>
    </>}
    {area === 'monthly' && <>
          <ActionRow
            title="Generate monthly briefing"
            summary="Create a draft briefing for review before publication."
            description={`Assesses published analyses, Fact Flow and collected source evidence from the selected dates (inclusive, Europe/Warsaw), comparing with the previous briefing. Saves a pending draft focused on supported shifts, practical consequences and questions to watch. Once approved, it is listed under Monthly Briefing. A thin month produces a shorter update. Review it under Drafts, then choose Approve & publish to make it live. If a briefing already exists for the period you’ll be asked before another draft is created.`}
            controls={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setConfirm('monthly'); clearFlash() }}
                disabled={monthlyRunning || invalidReportRange || confirm === 'monthly' || confirm === 'monthly-force'}
              >
                {monthlyRunning ? 'Generating…' : 'Run'}
              </Button>
            }
          >
            <div className="flex flex-wrap gap-3 mt-3">
              <label className="text-sm">Briefing start date
                <input type="date" className="block border rounded px-2 py-1 mt-1" value={reportStart} max={reportEnd || undefined}
                  disabled={monthlyRunning} onChange={e => { setReportStart(e.target.value); setConfirm(null); setMonthlyDraftId(null); clearFlash() }} />
              </label>
              <label className="text-sm">Briefing end date
                <input type="date" className="block border rounded px-2 py-1 mt-1" value={reportEnd} min={reportStart || undefined}
                  disabled={monthlyRunning} onChange={e => { setReportEnd(e.target.value); setConfirm(null); setMonthlyDraftId(null); clearFlash() }} />
              </label>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Both dates are included, in Warsaw time. Choose part of a month for a test draft; publication requires approval.</p>
            {invalidReportRange && <p role="alert" className="text-sm mt-2">Choose a start date and an end date on or after it.</p>}
            {confirm === 'monthly' && (
              <ActionPanel
                text={<>Generate a monthly briefing draft for <strong>{reportLabel}</strong> from published analysis, Fact Flow and collected source evidence, compared with the previous briefing?</>}
                actions={
                  <>
                    <Button size="sm" onClick={() => runMonthly(false)} disabled={monthlyRunning}>Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  </>
                }
              />
            )}
            {confirm === 'monthly-force' && (
              <ActionPanel
                tone="warn"
                text={<>A briefing for <strong>{reportLabel}</strong> already exists. Generate a new draft for review?</>}
                actions={
                  <>
                    <Button size="sm" onClick={() => runMonthly(true)} disabled={monthlyRunning}>Yes, regenerate</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setConfirm(null); clearFlash() }}>Cancel</Button>
                  </>
                }
              />
            )}
            {status('monthly')}
            {monthlyDraftId && <Link href={`/admin/monthly/drafts/${monthlyDraftId}`} className="text-sm underline" style={{ color: 'var(--accent)' }}>Review monthly briefing draft →</Link>}
          </ActionRow>
    </>}
    {area === 'articles' && <>
          <ActionRow
            title="Backfill embeddings"
            summary="Fill missing search and related-reading vectors."
            description="Generates a semantic-search vector for every published article that doesn’t have one, batching until none are left. Without a vector an article is invisible to /search ranking and to related-reading suggestions. New articles are embedded automatically on publish, so this is only needed after a bulk import or a failed embed."
            controls={<BackfillEmbeddingsButton />}
          />


    </>}
    {area === 'facts' && <>
          <ActionRow
            title="Backfill Fact Flow"
            summary="Add missing facts from previously published articles."
            controlsClass="admin-action__controls--input"
            description="Single-source articles get their one Fact Flow fact automatically on approval. This fills gaps left behind: enter a slug — the part of a URL after /articles/ — to give one article its fact, or run Backfill all to walk every eligible article that still has none, newest first. Facts are dated to their article’s publication date, so backfilling slots them into the stream in order instead of piling old news at the top. Backfill all excludes monthly briefings. An article that already has a fact is never touched."
            controls={
              <>
                <input
                  type="text"
                  value={backfillSlug}
                  onChange={e => setBackfillSlug(e.target.value)}
                  placeholder="article-slug"
                  aria-label="Article slug"
                  className="admin-action__input"
                  onKeyDown={e => { if (e.key === 'Enter') backfillFacts() }}
                  disabled={backfillRunning}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={backfillFacts}
                  disabled={backfillRunning || !backfillSlug.trim()}
                >
                  {backfillRunning ? 'Extracting…' : 'Backfill'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={backfillAllFacts}
                  disabled={backfillRunning || backfillAllRunning}
                >
                  {backfillAllRunning ? 'Backfilling…' : 'Backfill all'}
                </Button>
              </>
            }
          >
            {status('facts')}
          </ActionRow>
    </>}
  </div>
}
