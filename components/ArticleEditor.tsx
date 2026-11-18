'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { marked } from 'marked'
import { CitationWordingNote } from '@/components/CitationWordingNote'

interface ArticleEditorProps {
  initialContent?: string
  onPublish: (content: string) => void
  onSaveDraft?: (content: string) => void
  loading?: boolean
}

export function ArticleEditor({ initialContent = '', onPublish, onSaveDraft, loading }: ArticleEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 border-b border-gray-100">
        {(['write', 'preview'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'border-b-2 border-[#0F6E52] text-[#0F6E52]' : 'text-[#5B665F]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'write' ? (
        <Textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={24}
          className="font-mono text-sm"
          placeholder="# Article title&#10;&#10;Content in Markdown..."
        />
      ) : (
        <div
          className="prose max-w-none min-h-64 rounded-lg border border-gray-200 bg-white p-6"
          dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
        />
      )}

      <CitationWordingNote content={content} />
      <div className="flex gap-3">
        <Button onClick={() => onPublish(content)} disabled={loading}>
          {loading ? 'Publishing…' : 'Publish now'}
        </Button>
        {onSaveDraft && (
          <Button variant="secondary" onClick={() => onSaveDraft(content)} disabled={loading}>
            Save as draft
          </Button>
        )}
      </div>
    </div>
  )
}
