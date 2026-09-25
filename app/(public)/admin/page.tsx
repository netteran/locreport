'use client'
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IngestButton, type IngestResult } from '@/components/IngestButton'
import { BackfillEmbeddingsButton } from '@/components/BackfillEmbeddingsButton'
import { RunFeedButton, type RunFeedResult } from '@/components/RunFeedButton'

type Confirm = 'ingest' | 'monthly' | 'monthly-force' | null
type DigestPreview = { recipients: number; skipped: number; articles: number }
type RowKey = 'ingest' | 'feeds' | 'monthly' | 'digest' | 'facts' | 'quotes' | 'pricing'

// One row of the action list. The title doubles as the toggle for its
// explanation, so the resting state is just a title and its controls;
// anything passed as children (confirmation panels, result messages)
// renders below the head and is never hidden behind the toggle.
function ActionRow({ title, description, controls, controlsClass, children }: {
  title: string
  description: string
  controls: ReactNode
  controlsClass?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="admin-action">
      <div className="admin-action__head">
        <button
          type="button"
          className="admin-action__title"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <span className="admin-action__chevron" aria-hidden="true">›</span>
          {title}
        </button>
        <div className={`admin-action__controls${controlsClass ? ` ${controlsClass}` : ''}`}>{controls}</div>
      </div>
      {open && <p className="admin-action__desc">{description}</p>}
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

export default function AdminDashboard() {
  const [stats, setStats] = useState<{ articles: number; drafts: number; sources: number } | null>(null)
  const [monthlyRunning, setMonthlyRunning] = useState(false)
  const [quotesRunning, setQuotesRunning] = useState(false)
  const [pricingRunning, setPricingRunning] = useState(false)
  const [digestPreviewing, setDigestPreviewing] = useState(false)
  const [digestSending, setDigestSending] = useState(false)
  const [digestPreview, setDigestPreview] = useState<DigestPreview | null>(null)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillSlug, setBackfillSlug] = useState('')
  const [backfillAllRunning, setBackfillAllRunning] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error'>('ok')
  const [messageFor, setMessageFor] = useState<RowKey | null>(null)

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats)
  }, [])

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
      <p className={`admin-action__status${messageType === 'error' ? ' admin-action__status--error' : ''}`}>
        {message}
      </p>
    )
  }

  function refreshStats() {
    fetch('/api/stats').then(r => r.json()).then(setStats)
  }

  async function runMonthly(force = false) {
    setConfirm(null)
    setMonthlyRunning(true)
    clearFlash()
    const res = await fetch('/api/monthly-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
    const data = await res.json()
    if (res.status === 409 && !force) {
      // Report already exists — ask to force
      setMonthlyRunning(false)
      setConfirm('monthly-force')
      flash('monthly', `A monthly report for this period already exists${data.existing_id ? ` (ID: ${data.existing_id})` : ''}.`, 'error')
      return
    }
    flash(
      'monthly',
      res.ok
        ? `Monthly report generated: "${data.title}" — ${data.article_count} articles summarised.`
        : (data.error ?? 'Generation failed.'),
      res.ok ? 'ok' : 'error',
    )
    setMonthlyRunning(false)
    if (res.ok) refreshStats()
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

  // Sending a digest emails real subscribers and can't be undone, so the
  // buttons resolve the recipient list first (dry run) and only send once the
  // admin confirms against those numbers.
  async function previewDigest() {
    setDigestPreviewing(true)
    setDigestPreview(null)
    clearFlash()
    try {
      const res = await fetch('/api/digest/send?dry=1', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        flash('digest', data.error ?? 'Preview failed.', 'error')
        return
      }
      setDigestPreview({
        recipients: data.recipients ?? 0,
        skipped: data.skipped ?? 0,
        articles: data.articles ?? 0,
      })
    } catch {
      flash('digest', 'Preview failed.', 'error')
    } finally {
      setDigestPreviewing(false)
    }
  }

  async function sendDigest() {
    setDigestSending(true)
    clearFlash()
    try {
      const res = await fetch('/api/digest/send', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        flash('digest', data.error ?? 'Send failed.', 'error')
        return
      }
      const errors: string[] = data.errors ?? []
      flash(
        'digest',
        `The Weekly sent to ${data.sent} subscriber${data.sent !== 1 ? 's' : ''}` +
          ` — ${data.skipped} skipped, ${data.articles} article${data.articles !== 1 ? 's' : ''} in period.` +
          (errors.length ? ` ${errors.length} error${errors.length !== 1 ? 's' : ''}: ${errors.join('; ')}` : ''),
        errors.length ? 'error' : 'ok',
      )
      setDigestPreview(null)
    } catch {
      flash('digest', 'Send failed — it may still have gone out. Check Resend before retrying.', 'error')
    } finally {
      setDigestSending(false)
    }
  }

  const now = new Date()
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text)' }}>Dashboard</h1>

      <div className="admin-stats-banner">
        {[
          { label: 'Published', value: stats?.articles, href: '/admin/articles' },
          { label: 'Drafts', value: stats?.drafts, href: '/admin/drafts', danger: true },
          { label: 'Sources', value: stats?.sources, href: '/admin/sources' },
        ].map(({ label, value, href, danger }) => (
          <span key={label} className="admin-stats-banner__item">
            <Link
              href={href}
              className={`admin-stats-banner__value${danger ? ' admin-stats-banner__value--danger' : ''}`}
            >
              {value ?? '—'}
            </Link>
            <span className="admin-stats-banner__label">{label}</span>
          </span>
        ))}
      </div>

      <div className="admin-actions">

        <ActionRow
          title="Run ingest"
          description="Fetches every active RSS source, drops anything already seen, then runs each new item through the extractor and classifier prompts to build a draft with its title, excerpt, signals, impact score and business implications. Nothing is published — new items land in Drafts as pending and wait for review. Also runs automatically via GitHub Actions daily at 10:30 UTC."
          controls={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setConfirm('ingest'); clearFlash() }}
              disabled={confirm === 'ingest'}
            >
              Run
            </Button>
          }
        >
          {confirm === 'ingest' && (
            <ActionPanel
              text="Fetch all active RSS sources and create new pending drafts?"
              actions={
                <>
                  <IngestButton
                    label="Confirm"
                    onDone={(result: IngestResult) => {
                      setConfirm(null)
                      refreshStats()
                      flash('ingest', `+${result.processed} draft${result.processed !== 1 ? 's' : ''} created, ${result.skipped} skipped.`)
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                </>
              }
            />
          )}
          {status('ingest')}
        </ActionRow>

        <ActionRow
          title="Run feed generator"
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
          title="Backfill embeddings"
          description="Generates a semantic-search vector for every published article that doesn’t have one, batching until none are left. Without a vector an article is invisible to /search ranking and to related-reading suggestions. New articles are embedded automatically on publish, so this is only needed after a bulk import or a failed embed."
          controls={<BackfillEmbeddingsButton />}
        />

        <ActionRow
          title="Generate monthly report"
          description={`Sends every industry article published in ${prevMonth} to the model for synthesis and publishes the result as a monthly-summary article, listed under Reports → Monthly. It goes live immediately — there is no draft step. If a report already exists for the period you’ll be asked before a second one is created.`}
          controls={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setConfirm('monthly'); clearFlash() }}
              disabled={monthlyRunning || confirm === 'monthly' || confirm === 'monthly-force'}
            >
              {monthlyRunning ? 'Generating…' : 'Run'}
            </Button>
          }
        >
          {confirm === 'monthly' && (
            <ActionPanel
              text={<>Generate and publish a monthly report for <strong>{prevMonth}</strong> from all industry articles in that period?</>}
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
              text={<>A report for <strong>{prevMonth}</strong> already exists. Generate a second one anyway?</>}
              actions={
                <>
                  <Button size="sm" onClick={() => runMonthly(true)} disabled={monthlyRunning}>Yes, regenerate</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setConfirm(null); clearFlash() }}>Cancel</Button>
                </>
              }
            />
          )}
          {status('monthly')}
        </ActionRow>

        <ActionRow
          title="Send The Weekly"
          description="Composes this week's issue of The Weekly — one issue, identical for every confirmed subscriber, covering the last 7 days: headline numbers, the top story, how every one of the 13 signals moved against its 4-week average, five Fact Flow facts, a LocStock brief and new directory companies (each only when there is something to report), then every other article — and sends it through Resend. Subscribers have no preferences, only a one-click unsubscribe. Preview only counts recipients; View sample opens the exact issue in a new tab. Nothing is sent until you confirm. Anyone already sent within the period is skipped, so a manual run is safe to repeat. Scheduled automatically every Friday at 1pm Central European time."
          controls={
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={previewDigest}
                disabled={digestPreviewing || digestSending}
              >
                {digestPreviewing ? 'Checking…' : 'Preview'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.open('/api/digest/preview', '_blank', 'noopener,noreferrer')}
              >
                View sample
              </Button>
              <Link
                href="/admin/digest-history"
                className="text-sm px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--muted)' }}
              >
                Past sends →
              </Link>
            </>
          }
        >
          {digestPreview && (digestPreview.recipients === 0 ? (
            <ActionPanel
              text={
                <>
                  Nobody would receive The Weekly right now
                  {' '}({digestPreview.articles} article{digestPreview.articles !== 1 ? 's' : ''} in period,
                  {' '}{digestPreview.skipped} subscriber{digestPreview.skipped !== 1 ? 's' : ''} skipped).
                </>
              }
              actions={<Button size="sm" variant="ghost" onClick={() => setDigestPreview(null)}>Close</Button>}
            />
          ) : (
            <ActionPanel
              tone="warn"
              text={
                <>
                  This sends real email. The Weekly will go to{' '}
                  <strong>{digestPreview.recipients} subscriber{digestPreview.recipients !== 1 ? 's' : ''}</strong>
                  {' '}({digestPreview.skipped} skipped, {digestPreview.articles} article{digestPreview.articles !== 1 ? 's' : ''} in period).
                </>
              }
              actions={
                <>
                  <Button size="sm" onClick={sendDigest} disabled={digestSending}>
                    {digestSending ? 'Sending…' : `Send to ${digestPreview.recipients}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDigestPreview(null)} disabled={digestSending}>Cancel</Button>
                </>
              }
            />
          ))}
          {status('digest')}
        </ActionRow>

        <ActionRow
          title="Backfill Fact Flow"
          controlsClass="admin-action__controls--input"
          description="Every article published from now on gets its one Fact Flow fact automatically, on approval. This fills gaps left behind: enter a slug — the part of a URL after /articles/ — to give one article its fact, or run Backfill all to walk every article that still has none, newest first. Facts are dated to their article’s publication date, so backfilling slots them into the stream in order instead of piling old news at the top. Monthly reports are excluded. An article that already has a fact is never touched."
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

        <ActionRow
          title="Refresh market quotes"
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
          description="Pulls current per-token pricing for every tracked model from OpenRouter, updates the /compass/llm-pricing simulator, and writes a history row for any model whose price moved. Nothing schedules this — point a daily cron-job.org job at POST /api/llm-pricing to automate it."
          controls={
            <Button size="sm" variant="secondary" onClick={refreshPricing} disabled={pricingRunning}>
              {pricingRunning ? 'Refreshing…' : 'Refresh'}
            </Button>
          }
        >
          {status('pricing')}
        </ActionRow>

      </div>
    </div>
  )
}
