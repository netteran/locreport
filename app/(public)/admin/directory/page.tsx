'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { CATEGORY_SHORT, DIRECTORY_CATEGORIES, type DirectoryEntry } from '@/lib/data/directory'
import { LogoUpload } from './LogoUpload'

const CATEGORIES = DIRECTORY_CATEGORIES

const CAT_DISPLAY = CATEGORY_SHORT

const EMPTY_FORM = {
  name: '',
  slug: '',
  category: 'tms',
  website: '',
  description: '',
  long_description: '',
  founded: '',
  hq: '',
  address: '',
  type: '',
  tags: '',
  logo_url: '',
}

type FormState = typeof EMPTY_FORM

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export default function AdminDirectoryPage() {
  const searchParams = useSearchParams()
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isDbBacked, setIsDbBacked] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')

  const load = useCallback(async () => {
    const res = await fetch('/api/directory')
    const data: DirectoryEntry[] = await res.json()
    setEntries(data)
    if (data.length > 0 && data[0].id && /^[0-9a-f-]{36}$/.test(data[0].id)) {
      setIsDbBacked(true)
    }
    // Auto-open entry for editing if ?edit=slug is in the URL
    const editSlug = searchParams?.get('edit')
    if (editSlug) {
      const target = data.find(e => e.slug === editSlug)
      if (target) {
        setEditingSlug(target.slug)
        setForm({
          name: target.name,
          slug: target.slug,
          category: target.category,
          website: target.website,
          description: target.description,
          long_description: target.long_description || '',
          founded: String(target.founded),
          hq: target.hq,
          address: target.address || '',
          type: target.type,
          tags: (target.tags || []).join(', '),
          logo_url: target.logo_url || '',
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
  }, [searchParams])

  useEffect(() => { load() }, [load])

  function set(field: keyof FormState, value: string) {
    setForm(prev => {
      const updated = { ...prev, [field]: value }
      if (field === 'name' && !editingSlug) {
        updated.slug = slugify(value)
      }
      return updated
    })
  }

  function startEdit(entry: DirectoryEntry) {
    setEditingSlug(entry.slug)
    setForm({
      name: entry.name,
      slug: entry.slug,
      category: entry.category,
      website: entry.website,
      description: entry.description,
      long_description: entry.long_description || '',
      founded: String(entry.founded),
      hq: entry.hq,
      address: entry.address || '',
      type: entry.type,
      tags: (entry.tags || []).join(', '),
      logo_url: entry.logo_url || '',
    })
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingSlug(null)
    setForm(EMPTY_FORM)
    setMessage('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.website) return
    setSaving(true)
    setMessage('')

    const payload = {
      ...form,
      founded: form.founded ? parseInt(form.founded, 10) : null,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    }

    let res: Response
    if (editingSlug) {
      res = await fetch(`/api/directory/${editingSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    if (res.ok) {
      setMessage(editingSlug ? 'Entry updated.' : 'Entry added.')
      setIsDbBacked(true)
      setEditingSlug(null)
      setForm(EMPTY_FORM)
      load()
    } else {
      const err = await res.json()
      setMessage(err.error ?? 'Failed to save entry.')
    }
    setSaving(false)
  }

  async function remove(slug: string, name: string) {
    if (!confirm(`Delete "${name}" from the directory?`)) return
    await fetch(`/api/directory/${slug}`, { method: 'DELETE' })
    load()
  }

  const filtered = entries.filter(e => {
    const matchesCat = filterCat === 'all' || e.category === filterCat
    const matchesSearch = !search.trim() ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase())
    return matchesCat && matchesSearch
  })

  const selectStyle = {
    width: '100%',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    outline: 'none',
  }

  const textareaStyle = {
    width: '100%',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    resize: 'vertical' as const,
    outline: 'none',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Directory</h1>
        <Link
          href="/compass/directory"
          target="_blank"
          className="text-sm underline underline-offset-2"
          style={{ color: 'var(--muted)' }}
        >
          View public page →
        </Link>
      </div>

      {!isDbBacked && entries.length > 0 && (
        <div className="mb-6 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          Showing static data. Entries you add here are stored in the database. To enable full CRUD, create a <code>directory</code> table in Supabase matching the DirectoryEntry schema.
        </div>
      )}

      <div className="admin-directory-stack">
        {/* Form */}
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            {editingSlug ? `Editing: ${form.name}` : 'Add entry'}
          </h2>
          <form onSubmit={submit} className="admin-directory-form">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
              <div className="flex flex-col gap-3">
                <Input
                  placeholder="Company / tool name *"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  required
                />
                <Input
                  placeholder="Slug (auto-generated)"
                  value={form.slug}
                  onChange={e => set('slug', e.target.value)}
                />
              </div>
              <LogoUpload
                slug={form.slug}
                currentUrl={form.logo_url || undefined}
                onUploaded={url => set('logo_url', url)}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--muted)' }}>Category</label>
              <select style={selectStyle} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Input
              placeholder="Website URL *"
              type="url"
              value={form.website}
              onChange={e => set('website', e.target.value)}
              required
            />
            <Input
              placeholder="Type (e.g. SaaS, LSP, Open Source)"
              value={form.type}
              onChange={e => set('type', e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Founded year"
                type="number"
                value={form.founded}
                onChange={e => set('founded', e.target.value)}
              />
              <Input
                placeholder="HQ (e.g. Berlin, Germany)"
                value={form.hq}
                onChange={e => set('hq', e.target.value)}
              />
            </div>
            <Input
              placeholder="Full address"
              value={form.address}
              onChange={e => set('address', e.target.value)}
            />
            <textarea
              placeholder="Short description (shown on listing page) *"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              style={textareaStyle}
              required
            />
            <textarea
              placeholder="Long description (shown on detail page)"
              value={form.long_description}
              onChange={e => set('long_description', e.target.value)}
              rows={6}
              style={textareaStyle}
            />
            <Input
              placeholder="Tags (comma-separated, e.g. tms, api, enterprise)"
              value={form.tags}
              onChange={e => set('tags', e.target.value)}
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : editingSlug ? 'Update entry' : 'Add entry'}
              </Button>
              {editingSlug && (
                <Button type="button" variant="secondary" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
            </div>
            {message && (
              <p className="text-sm" style={{ color: message.includes('added') || message.includes('updated') ? 'var(--accent)' : 'red' }}>
                {message}
              </p>
            )}
          </form>
        </div>

        {/* Entries list */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              {filtered.length} of {entries.length} entries
            </h2>
            <div className="flex gap-2">
              <select
                style={{ ...selectStyle, width: 'auto', padding: '6px 10px', fontSize: '0.78rem' }}
                value={filterCat}
                onChange={e => setFilterCat(e.target.value)}
              >
                <option value="all">All categories</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search entries…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...selectStyle, padding: '8px 12px' }}
            />
          </div>
          <div className="flex flex-col gap-2" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {filtered.map(entry => (
              <Card key={entry.slug || entry.name} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  {entry.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.logo_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border)', padding: 2, background: 'var(--surface)', flexShrink: 0 }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{entry.name}</p>
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px',
                        borderRadius: 100, background: 'var(--accent-soft)', color: 'var(--accent)',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        {CAT_DISPLAY[entry.category] ?? entry.category}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{entry.hq} · {entry.type}</p>
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--muted)' }}>{entry.description}</p>
                    <div className="flex gap-2 mt-1.5">
                      <Link
                        href={`/compass/directory/${entry.slug || entry.name.toLowerCase().replace(/\s+/g, '-')}`}
                        target="_blank"
                        className="text-xs underline underline-offset-1"
                        style={{ color: 'var(--accent)' }}
                      >
                        View page
                      </Link>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(entry)}>
                      Edit
                    </Button>
                    {isDbBacked && (
                      <Button size="sm" variant="danger" onClick={() => remove(entry.slug, entry.name)}>
                        Del
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
