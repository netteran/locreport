'use client'
import { useState } from 'react'
import { ImageDropzone } from '@/components/ImageDropzone'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export function AnnualImageForm({ slug, initialUrl, initialAlt }: { slug: string; initialUrl: string; initialAlt: string }) {
  const [imageUrl, setImageUrl] = useState(initialUrl)
  const [imageAlt, setImageAlt] = useState(initialAlt)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/reports/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, image_url: imageUrl.trim(), image_alt: imageAlt.trim() }),
    })
    const d = await res.json().catch(() => ({}))
    setMessage(res.ok ? { text: 'Saved.', ok: true } : { text: d.error ?? 'Save failed', ok: false })
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <ImageDropzone
        value={imageUrl}
        onChange={setImageUrl}
        hint="Optional. Shown at the top of the report, on the Reports page, and as its social-media thumbnail."
      />
      <div>
        <Label>Image alt text</Label>
        <Input
          value={imageAlt}
          onChange={e => setImageAlt(e.target.value)}
          placeholder="Describe the image — falls back to the report title"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        {message && <span className={`text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</span>}
      </div>
    </div>
  )
}
