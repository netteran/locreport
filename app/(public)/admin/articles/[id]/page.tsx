'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Article } from '@/lib/types'
import { ArticleEditor } from '@/components/ArticleEditor'
import { ImageDropzone } from '@/components/ImageDropzone'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ContentTypeField } from '@/components/ContentTypeField'
import { type ContentType, getContentType } from '@/lib/contentTaxonomy'
import { Button } from '@/components/ui/button'

export default function EditArticlePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [article, setArticle] = useState<Article | null>(null)
  const [title, setTitle] = useState('')
  const [contentType, setContentType] = useState<ContentType>('analysis')
  const [sourceUrl, setSourceUrl] = useState('')
  const [slug, setSlug] = useState('')
  const [publisher, setPublisher] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageAlt, setImageAlt] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [impactScore, setImpactScore] = useState<number | null>(null)
  const [timeHorizon, setTimeHorizon] = useState<string>('')

  useEffect(() => {
    fetch(`/api/articles/${id}`).then(r => r.json()).then((a: Article) => {
      setArticle(a)
      setContentType(getContentType(a))
      setSourceUrl(a.source_url ?? '')
      setTitle(a.title)
      setSlug(a.slug ?? '')
      setPublisher(a.publisher ?? '')
      setImageUrl(a.image_url ?? '')
      setImageAlt(a.image_alt ?? '')
      setImpactScore(a.impact_score ?? null)
      setTimeHorizon(a.time_horizon ?? '')
    })
  }, [id])

  async function save(content: string) {
    setSaving(true)
    setMessage('')
    const res = await fetch(`/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, content, slug, contentType,
        source_url: sourceUrl.trim() || null,
        publisher: publisher || null,
        image_url: imageUrl.trim() || null,
        image_alt: imageAlt.trim() || null,
        impact_score: impactScore,
        time_horizon: timeHorizon || null,
      }),
    })
    if (res.ok) {
      setMessage('Saved.')
    } else {
      const d = await res.json()
      setMessage(d.error ?? 'Save failed')
    }
    setSaving(false)
  }

  if (!article) return <p className="text-[#5B665F]">Loading…</p>

  return (
    <div className="max-w-[760px]">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>← Back</Button>
        <h1 className="text-xl font-bold text-[#15191C]">{article.article_type === 'monthly-summary' ? 'Edit monthly briefing' : 'Edit article'}</h1>
        {message && <span className="text-sm text-green-600">{message}</span>}
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Slug</Label>
          <Input value={slug} onChange={e => setSlug(e.target.value)} />
        </div>
        <div>
          <Label>Publisher</Label>
          <Input value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="e.g. Argos Multilingual" />
        </div>
        <ContentTypeField value={contentType} onChange={setContentType} disabled={saving} />
        <div>
          <Label htmlFor="article-source-url">Original source URL</Label>
          <Input id="article-source-url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" />
        </div>
        <ImageDropzone
          value={imageUrl}
          onChange={setImageUrl}
          hint={article.article_type === 'monthly-summary'
            ? 'Optional. Shown at the top of the report, on its card in Reports → Monthly, and as its social-media thumbnail.'
            : 'Optional. Shown at the top of the article, as a thumbnail in the article lists, and as its social-media thumbnail.'}
        />
        <div>
          <Label>Image alt text</Label>
          <Input
            value={imageAlt}
            onChange={e => setImageAlt(e.target.value)}
            placeholder="Describe the image — falls back to the article title"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Impact score</Label>
            <select
              value={impactScore ?? ''}
              onChange={e => setImpactScore(e.target.value ? Number(e.target.value) : null)}
              className="w-full mt-1 rounded-md border px-3 py-2 text-sm"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="">— not set —</option>
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n} — {['Minimal', 'Low', 'Moderate', 'High', 'Critical'][n - 1]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Time horizon</Label>
            <select
              value={timeHorizon}
              onChange={e => setTimeHorizon(e.target.value)}
              className="w-full mt-1 rounded-md border px-3 py-2 text-sm"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="">— not set —</option>
              <option value="now">Now</option>
              <option value="6months">6 months</option>
              <option value="long-term">Long-term</option>
            </select>
          </div>
        </div>
      </div>

      <ArticleEditor
        initialContent={article.content}
        onPublish={save}
        loading={saving}
      />
    </div>
  )
}
