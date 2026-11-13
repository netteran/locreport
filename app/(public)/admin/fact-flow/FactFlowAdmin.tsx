'use client'

import { useState } from 'react'

type Fact = {
  id: string
  content: string
  category: string
  source_name: string | null
  source_url: string | null
  status: 'pending'|'published'|'rejected'|'withdrawn'
  published_at: string | null
  review_reason: string | null
  event_id: string | null
  article_id: string | null
  created_at: string
  articles: { slug: string }[] | null
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function FactRow({ fact, onDeleted, onSaved, onLinked }: {
  fact: Fact
  onDeleted: (id: string) => void
  onSaved: (id: string, content: string) => void
  onLinked: (id: string, article_id: string | null, slug: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.content)
  const [linkingArticle, setLinkingArticle] = useState(false)
  const [slugInput, setSlugInput] = useState(fact.articles?.[0]?.slug ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!draft.trim() || draft === fact.content) { setEditing(false); return }
    setBusy(true)
    setError('')
    const res = await fetch(`/api/facts/${fact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: draft.trim() }),
    })
    setBusy(false)
    if (!res.ok) { setError('Save failed'); return }
    onSaved(fact.id, draft.trim())
    setEditing(false)
  }

  async function saveLink() {
    setBusy(true)
    setError('')
    const slug = slugInput.trim() || null

    if (slug) {
      // Resolve slug → article_id
      const res = await fetch(`/api/articles?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) { setBusy(false); setError('Article not found'); return }
      const data = await res.json()
      const article = Array.isArray(data) ? data[0] : data?.article ?? data
      if (!article?.id) { setBusy(false); setError('Article not found'); return }

      const patchRes = await fetch(`/api/facts/${fact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: article.id }),
      })
      setBusy(false)
      if (!patchRes.ok) { setError('Link failed'); return }
      onLinked(fact.id, article.id, slug)
    } else {
      // Clear the link
      const patchRes = await fetch(`/api/facts/${fact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: null }),
      })
      setBusy(false)
      if (!patchRes.ok) { setError('Unlink failed'); return }
      onLinked(fact.id, null, null)
    }
    setLinkingArticle(false)
  }

  async function deleteFact() {
    setBusy(true)
    setError('')
    const res = await fetch(`/api/facts/${fact.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError('Delete failed'); setConfirming(false); return }
    onDeleted(fact.id)
  }

  const articleSlug = fact.articles?.[0]?.slug ?? null

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: 'var(--space-4) 0' }}>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--accent)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.9rem',
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'var(--font-body)',
            }}
          />
          {error && <p style={{ fontSize: '0.75rem', color: '#dc2626' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={save}
              disabled={busy}
              style={{ fontSize: '0.8rem', padding: '4px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(fact.content); setError('') }}
              disabled={busy}
              style={{ fontSize: '0.8rem', padding: '4px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.55, margin: 0 }}>{fact.content}</p>
            <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '4px' }}>
              {timeAgo(fact.published_at||fact.created_at)}
              {fact.source_name && ` · ${fact.source_name}`}
              {fact.source_url && (
                <> · <a href={fact.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>source</a></>
              )}
              {articleSlug && (
                <> · <a href={`/articles/${articleSlug}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>article</a></>
              )}
            </p>

            {/* Article link editor */}
            {linkingArticle && (
              <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={slugInput}
                  onChange={e => setSlugInput(e.target.value)}
                  placeholder="article slug (leave blank to unlink)"
                  style={{
                    flex: 1,
                    minWidth: 200,
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--accent)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') saveLink(); if (e.key === 'Escape') { setLinkingArticle(false); setSlugInput(articleSlug ?? '') } }}
                  autoFocus
                />
                <button
                  onClick={saveLink}
                  disabled={busy}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? '…' : slugInput.trim() ? 'Link' : 'Unlink'}
                </button>
                <button
                  onClick={() => { setLinkingArticle(false); setSlugInput(articleSlug ?? ''); setError('') }}
                  disabled={busy}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                {error && <span style={{ fontSize: '0.72rem', color: '#dc2626' }}>{error}</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
            {confirming ? (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Delete?</span>
                <button
                  onClick={deleteFact}
                  disabled={busy}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? '…' : 'Yes'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  Edit
                </button>
                <button
                  onClick={() => { setLinkingArticle(v => !v); setSlugInput(articleSlug ?? ''); setError('') }}
                  style={{
                    fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)',
                    background: articleSlug ? 'var(--accent-soft, #eef0ff)' : 'var(--bg-secondary)',
                    color: articleSlug ? 'var(--accent)' : 'var(--muted)',
                    border: '1px solid var(--border)', cursor: 'pointer'
                  }}
                >
                  {articleSlug ? 'Linked' : 'Link'}
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Delete
                </button>
              </>
            )}
            {!linkingArticle && error && <span style={{ fontSize: '0.72rem', color: '#dc2626' }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function AddFactForm({ onAdded }: { onAdded: (fact: Fact) => void }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [slug, setSlug] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setBusy(true)
    setError('')
    const res = await fetch('/api/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.trim(), slug: slug.trim() || null, source_url: sourceUrl.trim() || null }),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to add fact')
      return
    }
    const newFact: Fact = await res.json()
    // Attach the slug so it renders correctly in the list
    if (slug.trim()) newFact.articles = [{ slug: slug.trim() }]
    onAdded(newFact)
    setContent('')
    setSlug('')
    setSourceUrl('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontSize: '0.82rem', padding: '6px 14px', borderRadius: 'var(--radius-md)',
          background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        + Add fact
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      style={{
        marginBottom: 'var(--space-6)', padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
        background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>New fact</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Content</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={3}
          placeholder="Self-contained news sentence…"
          required
          style={{
            padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
            fontSize: '0.9rem', lineHeight: 1.5, resize: 'vertical', fontFamily: 'var(--font-body)',
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Article slug (optional)</label>
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="my-article-slug"
            style={{
              padding: '6px 10px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
              fontSize: '0.82rem', fontFamily: 'var(--font-mono)',
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Source URL (optional)</label>
          <input
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="https://…"
            style={{
              padding: '6px 10px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
              fontSize: '0.82rem', fontFamily: 'var(--font-body)',
            }}
          />
        </div>
      </div>

      {error && <p style={{ fontSize: '0.75rem', color: '#dc2626', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="submit"
          disabled={busy || !content.trim()}
          style={{
            fontSize: '0.82rem', padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
            opacity: (busy || !content.trim()) ? 0.6 : 1,
          }}
        >
          {busy ? 'Adding…' : 'Add fact'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setContent(''); setSlug(''); setSourceUrl(''); setError('') }}
          disabled={busy}
          style={{
            fontSize: '0.82rem', padding: '6px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export function FactFlowAdmin({ initialFacts }: { initialFacts: Fact[] }) {
  const [facts, setFacts] = useState(initialFacts)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [publicationError, setPublicationError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  async function changeStatus(ids: string[], status: Fact['status']) {
    setPublishing(true)
    setPublicationError('')
    try {
      for (const id of ids) {
        const r = await fetch(`/api/facts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        })
        if (!r.ok) throw new Error((await r.json()).error)
        setFacts((fs) =>
          fs.map((f) =>
            f.id === id
              ? { ...f, status, review_reason: status === 'published' ? null : f.review_reason }
              : f
          )
        )
        setSelected((s) => new Set([...s].filter((value) => value !== id)))
      }
    } catch (e) {
      setPublicationError(String(e))
    } finally {
      setPublishing(false)
    }
  }

  function handleAdded(fact: Fact) {
    setFacts((f) => [fact, ...f])
  }

  function handleDeleted(id: string) {
    setFacts((f) => f.filter((x) => x.id !== id))
  }

  function handleSaved(id: string, content: string) {
    setFacts((f) => f.map((x) => (x.id === id ? { ...x, content } : x)))
  }

  function handleLinked(id: string, article_id: string | null, slug: string | null) {
    setFacts((f) =>
      f.map((x) => (x.id === id ? { ...x, article_id, articles: slug ? [{ slug }] : null } : x))
    )
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)'
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.4rem',
            fontWeight: 700,
            color: 'var(--text)',
            margin: 0
          }}
        >
          Fact Flow
        </h1>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{facts.length} facts</span>
      </div>

      <div style={{ maxWidth: 760, marginBottom: 'var(--space-4)' }}>
        <AddFactForm onAdded={handleAdded} />
      </div>

      <div className="flex gap-2 mb-4">
        {['pending', 'published', 'rejected', 'withdrawn', 'all'].map((s) => (
          <button
            className="border rounded px-3 py-1 text-sm"
            key={s}
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
          >
            {s}
          </button>
        ))}
      </div>
      {selected.size > 0 && (
        <div className="flex gap-2 mb-4 text-sm">
          <span>{selected.size} selected</span>
          <button
            className="border rounded px-3 py-1"
            disabled={publishing}
            onClick={() => changeStatus([...selected], 'published')}
          >
            Publish selected
          </button>
          <button
            className="border rounded px-3 py-1"
            disabled={publishing}
            onClick={() => changeStatus([...selected], 'rejected')}
          >
            Reject selected
          </button>
        </div>
      )}
      {publicationError && (
        <p role="alert" className="text-sm text-red-600">
          {publicationError}
        </p>
      )}
      {facts.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>No facts yet.</p>
      ) : (
        <div style={{ maxWidth: 760 }}>
          {facts
            .filter((f) => statusFilter === 'all' || f.status === statusFilter)
            .map((fact) => (
              <div key={fact.id}>
                <div className="flex gap-2 flex-wrap items-center mb-2 text-xs">
                  {fact.status === 'pending' && (
                    <input
                      type="checkbox"
                      aria-label={`Select fact: ${fact.content}`}
                      checked={selected.has(fact.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s)
                          e.target.checked ? n.add(fact.id) : n.delete(fact.id)
                          return n
                        })
                      }
                    />
                  )}
                  <span>{fact.status}</span>
                  {fact.review_reason && <span className="text-red-600">{fact.review_reason}</span>}
                  {(fact.status === 'pending' || fact.status === 'withdrawn') && (
                    <button
                      disabled={publishing}
                      className="border rounded px-2 py-1"
                      onClick={() => changeStatus([fact.id], 'published')}
                    >
                      Publish fact
                    </button>
                  )}
                  {fact.status === 'pending' && (
                    <button
                      disabled={publishing}
                      className="border rounded px-2 py-1"
                      onClick={() => changeStatus([fact.id], 'rejected')}
                    >
                      Reject
                    </button>
                  )}
                  {fact.status === 'published' && (
                    <button
                      disabled={publishing}
                      className="border rounded px-2 py-1"
                      onClick={() => changeStatus([fact.id], 'withdrawn')}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
                <FactRow
                  key={fact.id}
                  fact={fact}
                  onDeleted={handleDeleted}
                  onSaved={handleSaved}
                  onLinked={handleLinked}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
