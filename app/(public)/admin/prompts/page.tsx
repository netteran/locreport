'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { DEFAULT_EXTRACTOR_PROMPT, DEFAULT_INDUSTRY_PROMPT, DEFAULT_MONTHLY_PROMPT, DEFAULT_FACTFLOW_PROMPT, DEFAULT_PODCAST_EXTRACTOR_PROMPT, DEFAULT_PODCAST_PROMPT } from '@/lib/prompts'

type PromptKey = 'prompt_extractor' | 'prompt_industry' | 'prompt_monthly' | 'prompt_factflow' | 'prompt_podcast_extractor' | 'prompt_podcast'

const PROMPTS: { key: PromptKey; label: string; hint?: string; default: string }[] = [
  { key: 'prompt_extractor', label: 'Stage 1 — Extractor (fact extraction)', hint: 'Today’s real date is injected automatically ahead of the article content at call time — no need to add it here.', default: DEFAULT_EXTRACTOR_PROMPT },
  { key: 'prompt_industry', label: 'Stage 2 — Industry editorial (LocReport voice)', default: DEFAULT_INDUSTRY_PROMPT },
  { key: 'prompt_factflow', label: 'Fact Flow — news signal distillation', hint: 'Runs after Stage 1 to pick the ONE most current, headline-worthy fact for the Fact Flow page. Today’s real date is injected automatically ahead of the fact sheet at call time — no need to add it here.', default: DEFAULT_FACTFLOW_PROMPT },
  { key: 'prompt_podcast_extractor', label: 'Podcast — episode notes (from transcript)', hint: 'Manual podcast drafts only (/admin/sources → Podcasts). Runs on Gemini over the full episode (YouTube video, audio or a pasted transcript). Today’s date, the episode title/description and the people roster are injected automatically.', default: DEFAULT_PODCAST_EXTRACTOR_PROMPT },
  { key: 'prompt_podcast', label: 'Podcast — article write-up', hint: 'Turns the episode notes into the article. The people roster, LinkedIn URLs and Spotify/YouTube links come from the podcast source’s config and are injected automatically; any link not listed there is stripped after generation.', default: DEFAULT_PODCAST_PROMPT },
  { key: 'prompt_monthly', label: 'Monthly report (2000-word synthesis)', hint: 'Used by the Next.js monthly report generator. The Jekyll GitHub Actions script has its own copy — update both if you change the structure.', default: DEFAULT_MONTHLY_PROMPT },
]

export default function PromptsPage() {
  const [values, setValues] = useState<Record<PromptKey, string>>({
    prompt_extractor: '',
    prompt_industry: '',
    prompt_monthly: '',
    prompt_factflow: '',
    prompt_podcast_extractor: '',
    prompt_podcast: '',
  })
  const [saving, setSaving] = useState<PromptKey | null>(null)
  const [saved, setSaved] = useState<PromptKey | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(({ settings }) => {
        setValues(v => ({
          prompt_extractor: settings.prompt_extractor || DEFAULT_EXTRACTOR_PROMPT,
          prompt_industry: settings.prompt_industry || DEFAULT_INDUSTRY_PROMPT,
          prompt_monthly: settings.prompt_monthly || DEFAULT_MONTHLY_PROMPT,
          prompt_factflow: settings.prompt_factflow || DEFAULT_FACTFLOW_PROMPT,
          prompt_podcast_extractor: settings.prompt_podcast_extractor || DEFAULT_PODCAST_EXTRACTOR_PROMPT,
          prompt_podcast: settings.prompt_podcast || DEFAULT_PODCAST_PROMPT,
        }))
        setLoading(false)
      })
  }, [])

  async function save(key: PromptKey) {
    setSaving(key)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: values[key] }),
    })
    setSaving(null)
    setSaved(key)
    setTimeout(() => setSaved(null), 2000)
  }

  function reset(key: PromptKey, defaultVal: string) {
    setValues(v => ({ ...v, [key]: defaultVal }))
  }

  if (loading) return <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading prompts…</div>

  return (
    <div className="max-w-[860px]">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>Prompt Editor</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>Edit the AI prompts used during article generation. Changes take effect immediately for all new articles.</p>

      <div className="flex flex-col gap-10">
        {PROMPTS.map(({ key, label, hint, default: defaultVal }) => (
          <div key={key}>
            <Label className="text-base font-semibold mb-1 block" style={{ color: 'var(--text)' }}>{label}</Label>
            {hint && <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>{hint}</p>}
            <Textarea
              value={values[key]}
              onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
              rows={18}
              className="font-mono text-xs mb-2"
            />
            <div className="flex gap-2">
              <Button onClick={() => save(key)} disabled={saving === key}>
                {saving === key ? 'Saving…' : saved === key ? 'Saved ✓' : 'Save'}
              </Button>
              <Button variant="secondary" onClick={() => reset(key, defaultVal)}>Reset to default</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
