'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  TOPIC_MAX_SOURCES, TOPIC_READY_EVIDENCE, TOPIC_READY_PUBLISHERS, TOPIC_ROLES, TOPIC_ROLE_LABELS,
  TOPIC_USEFUL_RELEVANCE, defaultCompositionSources, isUsefulMatch, topicEditorialDirection,
  type TopicDecision, type TopicRole, type TopicStatus
} from '@/lib/editorialTopics'

type Match = {
  candidate_id: string; similarity: number; relevance: number; role: TopicRole; contribution: string
  decision: TopicDecision; event_id: string | null; publisher: string
  source: { title: string; source_url: string; source_published_at: string | null; status: string; reserved_by: string | null }
}
type Topic = {
  id: string; title: string; brief: string; required_terms: string[]; status: TopicStatus; notify_email: boolean
  ready_at: string | null; last_matched_at: string | null; composition_id: string | null
  readiness: { independent: number; publishers: number; roles: TopicRole[]; gaps: string[]; ready: boolean }
  matches: Match[]
}
type Draft = { title: string; brief: string; required_terms: string; notify_email: boolean }
const EMPTY: Draft = { title: '', brief: '', required_terms: '', notify_email: false }
const STATUS_LABEL: Record<TopicStatus, string> = { watching: 'Gathering evidence', ready: 'Ready to write', paused: 'Paused', closed: 'Closed' }
const RELEVANCE_LABEL = ['Unrelated', 'Background only', 'Useful', 'Central']
const field = { background: 'var(--surface)', borderColor: 'var(--border)' }

async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}
const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function TopicForm({ initial, submitLabel, busy, onSubmit, onCancel }: {
  initial: Draft; submitLabel: string; busy: boolean; onSubmit: (d: Draft) => void; onCancel?: () => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); onSubmit(draft) }}>
      <label className="block text-xs space-y-1"><span>Topic</span>
        <Input value={draft.title} maxLength={250} required placeholder="e.g. Who pays for AI translation quality checks?"
          onChange={e => setDraft({ ...draft, title: e.target.value })} />
      </label>
      <label className="block text-xs space-y-1"><span>What you want to say</span>
        <textarea className="w-full rounded-lg border px-3 py-2 text-sm" style={field} rows={4} maxLength={4000} required
          placeholder="Your angle or question, the argument you expect to make, and what would prove you wrong."
          value={draft.brief} onChange={e => setDraft({ ...draft, brief: e.target.value })} />
      </label>
      <label className="block text-xs space-y-1"><span>Key terms (optional, comma-separated): a source must mention at least one</span>
        <Input value={draft.required_terms} placeholder="e.g. MTPE, post-editing"
          onChange={e => setDraft({ ...draft, required_terms: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.notify_email} onChange={e => setDraft({ ...draft, notify_email: e.target.checked })} />
        Email me when this topic is ready to write
      </label>
      <div className="flex gap-2 flex-wrap items-center">
        <Button type="submit" disabled={busy}>{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
        {busy && <span className="text-xs" style={{ color: 'var(--muted)' }}>Searching the evidence pool… this can take a minute.</span>}
      </div>
    </form>
  )
}

function MatchRow({ match, checked, onCheck, onDecide, busy }: {
  match: Match; checked: boolean; onCheck: (v: boolean) => void; onDecide: (d: TopicDecision) => void; busy: boolean
}) {
  const s = match.source
  const blocked = s.status === 'reserved' || s.status === 'dismissed'
  return (
    <li className="flex items-start gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <input type="checkbox" aria-label={`Use ${s.title}`} checked={checked} disabled={blocked || match.decision === 'rejected'}
        onChange={e => onCheck(e.target.checked)} />
      <div className="min-w-0 flex-1 text-sm">
        <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="font-medium break-words">{s.title} ↗</a>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          {match.publisher} · {s.source_published_at?.slice(0, 10) ?? 'Undated'} · {RELEVANCE_LABEL[match.relevance]}
          {match.decision === 'accepted' && ' · accepted'}
          {s.status === 'used' && ' · used in a published article'}
          {s.status === 'reserved' && <> · held by <Link className="underline" href={`/admin/candidates/compositions/${s.reserved_by}`}>another composition</Link></>}
          {s.status === 'dismissed' && ' · set aside in Candidates'}
        </p>
        {match.contribution && <p className="mt-1" style={{ color: 'var(--muted)' }}>{match.contribution}</p>}
      </div>
      <div className="flex gap-1 shrink-0">
        {match.decision !== 'accepted' && <Button size="xs" variant="secondary" disabled={busy} onClick={() => onDecide('accepted')}>Accept</Button>}
        {match.decision !== 'rejected' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => onDecide('rejected')}>Reject</Button>}
        {match.decision !== 'suggested' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => onDecide('suggested')}>Undo</Button>}
      </div>
    </li>
  )
}

function TopicCard({ topic, busy, run, reload }: {
  topic: Topic; busy: boolean; run: (a: () => Promise<void>) => void; reload: () => Promise<void>
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>(() => defaultCompositionSources(topic.matches))
  const selectable = (id: string) => {
    const m = topic.matches.find(x => x.candidate_id === id)
    return !!m && m.decision !== 'rejected' && !['reserved', 'dismissed'].includes(m.source.status)
  }
  const chosen = selected.filter(selectable)
  const visible = topic.matches.filter(m => m.decision !== 'rejected' && (isUsefulMatch(m)))
  const weak = topic.matches.filter(m => m.decision === 'suggested' && m.relevance < TOPIC_USEFUL_RELEVANCE)
  const rejected = topic.matches.filter(m => m.decision === 'rejected')
  const patch = (body: unknown) => run(async () => { await request(`/api/topics/${topic.id}`, json('PATCH', body)); await reload() })
  const check = (id: string, on: boolean) => setSelected(s => on ? [...s, id] : s.filter(x => x !== id))
  const row = (m: Match) => <MatchRow key={m.candidate_id} match={m} busy={busy} checked={chosen.includes(m.candidate_id)}
    onCheck={on => check(m.candidate_id, on)} onDecide={decision => patch({ action: 'decision', candidate_id: m.candidate_id, decision })} />

  const compose = () => run(async () => {
    const sources = chosen.map(id => topic.matches.find(m => m.candidate_id === id)!)
      .map(m => ({ title: m.source.title, role: m.role, contribution: m.contribution }))
    const angle = topicEditorialDirection(topic, sources, topic.readiness.gaps)
    const { id } = await request('/api/compositions', json('POST', { candidate_ids: chosen, title: topic.title, angle }))
    await request(`/api/topics/${topic.id}`, json('PATCH', { action: 'composition', composition_id: id }))
    router.push(`/admin/candidates/compositions/${id}`)
  })

  const r = topic.readiness
  return (
    <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: topic.status === 'ready' ? 'var(--accent)' : 'var(--border)' }}>
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{topic.title}</h2>
        <span className="text-xs font-medium" style={{ color: topic.status === 'ready' ? 'var(--accent)' : 'var(--muted)' }}>
          {STATUS_LABEL[topic.status]}{topic.notify_email && ' · email on'}
        </span>
      </div>
      {editing ? (
        <TopicForm busy={busy} submitLabel="Save & search again" onCancel={() => setEditing(false)}
          initial={{ title: topic.title, brief: topic.brief, required_terms: topic.required_terms.join(', '), notify_email: topic.notify_email }}
          onSubmit={d => run(async () => {
            await request(`/api/topics/${topic.id}`, json('PATCH', { action: 'update', ...d }))
            setEditing(false); await reload()
          })} />
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{topic.brief}</p>
          {topic.required_terms.length > 0 && <p className="text-xs" style={{ color: 'var(--muted)' }}>Key terms: {topic.required_terms.join(', ')}</p>}
        </>
      )}
      <div className="text-sm space-y-1">
        <p><strong>{r.independent}</strong> of {TOPIC_READY_EVIDENCE} independent sources · <strong>{r.publishers}</strong> of {TOPIC_READY_PUBLISHERS} publishers
          {' · '}{TOPIC_ROLES.map(role => <span key={role} className="mr-2" style={{ color: r.roles.includes(role) ? 'var(--text)' : 'var(--muted)', textDecoration: r.roles.includes(role) ? 'none' : 'line-through' }}>{TOPIC_ROLE_LABELS[role]}</span>)}
        </p>
        {r.gaps.length > 0 && <ul className="list-disc pl-5 text-xs" style={{ color: 'var(--muted)' }}>{r.gaps.map(g => <li key={g}>{g}</li>)}</ul>}
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Reports of the same event count once. New candidates are checked against this topic on every scheduled ingest
          {topic.last_matched_at && <> · last checked {new Date(topic.last_matched_at).toLocaleString()}</>}.
        </p>
      </div>

      {TOPIC_ROLES.map(role => {
        const list = visible.filter(m => m.role === role)
        return list.length ? <div key={role}>
          <h3 className="text-sm font-medium">{TOPIC_ROLE_LABELS[role]} ({list.length})</h3>
          <ul>{list.map(row)}</ul>
        </div> : null
      })}
      {!visible.length && <p className="text-sm">No useful sources yet. New candidates will be checked automatically.</p>}
      {weak.length > 0 && <details><summary className="text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>Background only ({weak.length})</summary><ul>{weak.map(row)}</ul></details>}
      {rejected.length > 0 && <details><summary className="text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>Rejected ({rejected.length})</summary><ul>{rejected.map(row)}</ul></details>}

      <div className="flex flex-wrap gap-2 items-center">
        <Button disabled={busy || chosen.length < 1 || chosen.length > TOPIC_MAX_SOURCES} onClick={compose}>
          Start composition with {chosen.length} source{chosen.length === 1 ? '' : 's'}
        </Button>
        {chosen.length > TOPIC_MAX_SOURCES && <span className="text-xs text-red-600">Choose at most {TOPIC_MAX_SOURCES}.</span>}
        {topic.composition_id && <Link className="text-sm underline" href={`/admin/candidates/compositions/${topic.composition_id}`}>Open last composition</Link>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="secondary" disabled={busy || topic.status === 'paused' || topic.status === 'closed'}
          onClick={() => patch({ action: 'match' })}>Find more sources now</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        {['watching', 'ready'].includes(topic.status)
          ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => patch({ action: 'status', status: 'paused' })}>Pause</Button>
          : <Button size="xs" variant="ghost" disabled={busy} onClick={() => patch({ action: 'status', status: 'watching' })}>{topic.status === 'closed' ? 'Reopen' : 'Resume'}</Button>}
        {topic.status !== 'closed' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => patch({ action: 'status', status: 'closed' })}>Close</Button>}
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => {
          if (confirm(`Delete the topic “${topic.title}”? Its sources stay in Candidates.`))
            run(async () => { await request(`/api/topics/${topic.id}`, { method: 'DELETE' }); await reload() })
        }}>Delete</Button>
      </div>
    </section>
  )
}

export function TopicsPanel({ onReadyCount }: { onReadyCount?: (n: number) => void }) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [migration, setMigration] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [adding, setAdding] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const load = useCallback(async () => {
    const d = await request('/api/topics')
    setTopics(d.topics); setMigration(d.migration || '')
  }, [])
  useEffect(() => { load().catch(e => setError(String(e))) }, [load])
  useEffect(() => { onReadyCount?.(topics.filter(t => t.status === 'ready').length) }, [topics, onReadyCount])
  const run = useCallback((action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    action().catch(e => setError(String(e))).finally(() => setBusy(false))
  }, [])
  const open = useMemo(() => topics.filter(t => t.status !== 'closed'), [topics])
  const closed = useMemo(() => topics.filter(t => t.status === 'closed'), [topics])

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Propose a topic you want to write about. Every scheduled ingest checks new candidates against it, judges what each one
        could contribute, and marks the topic ready once there are {TOPIC_READY_EVIDENCE} independent sources from at least {TOPIC_READY_PUBLISHERS} publishers.
        Sources already used in published articles count too. Nothing is written until you start a composition.
      </p>
      {migration && <p role="alert" className="text-sm text-red-600">{migration}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!migration && (adding ? (
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
          <TopicForm key={formKey} initial={EMPTY} busy={busy} submitLabel="Save & find sources" onCancel={() => setAdding(false)}
            onSubmit={d => run(async () => {
              const result = await request('/api/topics', json('POST', d))
              if (result.warning) setNotice(result.warning)
              setAdding(false); setFormKey(k => k + 1); await load()
            })} />
        </div>
      ) : <Button onClick={() => setAdding(true)}>+ Propose a topic</Button>)}
      {open.map(topic => <TopicCard key={`${topic.id}:${topic.matches.length}`} topic={topic} busy={busy} run={run} reload={load} />)}
      {!open.length && !migration && !adding && <p className="text-sm">No open topics yet.</p>}
      {closed.length > 0 && <details><summary className="text-sm cursor-pointer">Closed topics ({closed.length})</summary>
        <div className="space-y-4 mt-3">{closed.map(topic => <TopicCard key={topic.id} topic={topic} busy={busy} run={run} reload={load} />)}</div>
      </details>}
    </div>
  )
}
