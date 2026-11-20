import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { LLM_MODELS, LLM_PRICE_HISTORY, type LLMModel, type ModelPriceHistory } from '@/lib/data/llm-pricing'
import { PricingClient } from './PricingClient'
import { PricingHistoryChart } from './PricingHistoryChart'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export const metadata: Metadata = {
  title: 'AI Translation Cost Simulator',
  description: 'Compare monthly API translation costs across GPT-5.5, Claude, Gemini, DeepSeek, Kimi, Qwen, Grok, Mistral and more. Build your language programme pair by pair.',
  alternates: { canonical: '/llm-pricing' },
}

export default async function LLMPricingPage() {
  const supabase = createServiceClient()
  const [{ data: quotes }, { data: history }] = await Promise.all([
    supabase.from('llm_pricing_quotes').select('model_id, data'),
    supabase.from('llm_pricing_history').select('model_id, date, input, output').order('date', { ascending: true }),
  ])

  const liveByModel = new Map((quotes ?? []).map(row => [row.model_id, row.data as { input: number; output: number; context?: number }]))

  // Overlay live pricing onto the static fallback (keeps name/provider/notes stable).
  const models: LLMModel[] = LLM_MODELS.map(m => {
    const live = liveByModel.get(m.id)
    return live ? { ...m, input: live.input, output: live.output, context: live.context ?? m.context } : m
  })

  // Merge live history snapshots with the static seed history per model.
  const liveHistoryByModel = new Map<string, { date: string; input: number; output: number }[]>()
  for (const row of history ?? []) {
    const list = liveHistoryByModel.get(row.model_id) ?? []
    list.push({ date: row.date, input: row.input, output: row.output })
    liveHistoryByModel.set(row.model_id, list)
  }

  const priceHistory: ModelPriceHistory[] = LLM_PRICE_HISTORY.map(h => {
    const live = liveHistoryByModel.get(h.modelId)
    if (!live?.length) return h
    const merged = new Map(h.snapshots.map(s => [s.date, s]))
    for (const snap of live) merged.set(snap.date, snap)
    return { modelId: h.modelId, snapshots: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  })

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <h1 style={{ marginBottom: 'var(--space-2)' }}>AI Translation Cost Simulator</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-6)' }}>
        Build your language programme pair by pair, set word volumes, and compare monthly API costs across leading LLMs.
      </p>
      <PricingClient models={models} />
      <PricingHistoryChart models={models} history={priceHistory} />
    </div>
  )
}
