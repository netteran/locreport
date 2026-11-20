'use client'
import { useState, useMemo } from 'react'
import type { LLMModel } from '@/lib/data/llm-pricing'

interface Props {
  models: LLMModel[]
}

interface LanguagePair {
  id: number
  source: string
  target: string
  words: number
}

const LANGUAGES = [
  'English','Spanish','French','German','Chinese (Simplified)','Chinese (Traditional)',
  'Japanese','Korean','Arabic','Portuguese','Italian','Dutch','Russian','Polish',
  'Turkish','Swedish','Norwegian','Danish','Finnish','Czech','Romanian','Hungarian',
  'Ukrainian','Hindi','Thai','Vietnamese','Indonesian','Malay','Hebrew','Greek',
]

const PRESETS = [
  { label: 'Small agency', pairs: [
    { source:'English', target:'Spanish', words:50000 },
    { source:'English', target:'French', words:50000 },
    { source:'English', target:'German', words:30000 },
  ]},
  { label: 'Mid-size LSP', pairs: [
    { source:'English', target:'Spanish', words:200000 },
    { source:'English', target:'French', words:150000 },
    { source:'English', target:'German', words:100000 },
    { source:'English', target:'Chinese (Simplified)', words:80000 },
    { source:'English', target:'Japanese', words:60000 },
  ]},
  { label: 'Enterprise', pairs: [
    { source:'English', target:'Spanish', words:500000 },
    { source:'English', target:'French', words:400000 },
    { source:'English', target:'German', words:300000 },
    { source:'English', target:'Chinese (Simplified)', words:250000 },
    { source:'English', target:'Japanese', words:200000 },
    { source:'English', target:'Korean', words:150000 },
    { source:'English', target:'Arabic', words:120000 },
    { source:'English', target:'Portuguese', words:100000 },
  ]},
  { label: 'Multi-source', pairs: [
    { source:'English', target:'Spanish', words:200000 },
    { source:'English', target:'Chinese (Simplified)', words:150000 },
    { source:'English', target:'Japanese', words:100000 },
    { source:'Spanish', target:'English', words:80000 },
    { source:'Chinese (Simplified)', target:'English', words:60000 },
  ]},
]

const PROVIDER_COLORS: Record<string, { bg: string, text: string }> = {
  'OpenAI':         { bg: 'var(--warm-soft)', text: 'var(--warm-strong)' },
  'Anthropic':      { bg: 'var(--warm-soft)', text: 'var(--warm-strong)' },
  'Google':         { bg: 'var(--warm-soft)', text: 'var(--warm-strong)' },
  'Meta (via API)': { bg: 'var(--warm-soft)', text: 'var(--warm-strong)' },
  'DeepSeek':       { bg: 'var(--warm-soft)', text: 'var(--warm-strong)' },
}

function formatCtx(n: number): string {
  if (n >= 1000000) return `${(n/1000000).toFixed(0)}M`
  if (n >= 1000) return `${(n/1000).toFixed(0)}K`
  return String(n)
}

let nextId = 1

export function PricingClient({ models }: Props) {
  const [pairs, setPairs] = useState<LanguagePair[]>([
    { id: nextId++, source: 'English', target: 'Spanish', words: 50000 },
  ])
  const [wordsPerCall, setWordsPerCall] = useState(500)
  const [systemPromptTokens, setSystemPromptTokens] = useState(300)
  const [sortAsc, setSortAsc] = useState(true)
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(
    new Set(models.map(m => m.provider))
  )

  function addPair() {
    setPairs(prev => [...prev, { id: nextId++, source: 'English', target: 'Spanish', words: 50000 }])
  }

  function removePair(id: number) {
    setPairs(prev => prev.filter(p => p.id !== id))
  }

  function updatePair(id: number, field: keyof LanguagePair, value: string | number) {
    setPairs(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  function applyPreset(preset: typeof PRESETS[0]) {
    setPairs(preset.pairs.map(p => ({ ...p, id: nextId++ })))
  }

  function toggleProvider(provider: string) {
    setEnabledProviders(prev => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const allProviders = [...new Set(models.map(m => m.provider))]

  const totalWords = pairs.reduce((sum, p) => sum + (p.words || 0), 0)

  const results = useMemo(() => {
    if (totalWords === 0) return []
    const inputTokensPerCall = systemPromptTokens + (wordsPerCall * 1.3)
    const outputTokensPerCall = wordsPerCall * 1.3
    const totalCalls = Math.ceil(totalWords / wordsPerCall)
    const totalInputTokens = totalCalls * inputTokensPerCall
    const totalOutputTokens = totalCalls * outputTokensPerCall

    return models
      .filter(m => enabledProviders.has(m.provider))
      .map(m => ({
        ...m,
        monthlyCost: (totalInputTokens / 1_000_000 * m.input) + (totalOutputTokens / 1_000_000 * m.output),
        totalCalls,
      }))
      .sort((a, b) => sortAsc ? a.monthlyCost - b.monthlyCost : b.monthlyCost - a.monthlyCost)
  }, [pairs, wordsPerCall, systemPromptTokens, sortAsc, enabledProviders, models, totalWords])

  return (
    <>
      <div className="pcfg-panel">
        <div className="pcfg-panel-header">
          <div>
            <div className="pcfg-panel-title">Language programme</div>
            <p className="pcfg-total">
              {pairs.length} pair{pairs.length !== 1 ? 's' : ''} · {totalWords.toLocaleString()} words/month total
            </p>
          </div>
          <button className="pcfg-add-btn" onClick={addPair}>+ Add language pair</button>
        </div>

        <div className="pcfg-pairs-list">
          {pairs.length === 0 && (
            <p className="pcfg-empty-hint">No language pairs yet. Add one to get started.</p>
          )}
          {pairs.map(pair => (
            <div key={pair.id} className="pcfg-pair-row">
              <select
                className="pcfg-select"
                value={pair.source}
                onChange={e => updatePair(pair.id, 'source', e.target.value)}
              >
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="pcfg-arrow">→</div>
              <select
                className="pcfg-select"
                value={pair.target}
                onChange={e => updatePair(pair.id, 'target', e.target.value)}
              >
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <input
                type="number"
                className="pcfg-words"
                value={pair.words}
                min={0}
                onChange={e => updatePair(pair.id, 'words', parseInt(e.target.value) || 0)}
                placeholder="words/month"
              />
              <button className="pcfg-remove-btn" onClick={() => removePair(pair.id)} aria-label="Remove pair">✕</button>
            </div>
          ))}
        </div>

        <div className="pcfg-footer-row">
          <div className="pcfg-presets-row">
            <span className="pcfg-presets-label">Presets:</span>
            {PRESETS.map(p => (
              <button key={p.label} className="pricing-preset-btn" onClick={() => applyPreset(p)}>{p.label}</button>
            ))}
          </div>
        </div>

        <details className="pcfg-advanced">
          <summary className="pcfg-advanced-toggle">⚙ Advanced settings</summary>
          <div className="pcfg-advanced-body">
            <div className="pricing-param">
              <div className="pricing-param-header">
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)' }}>Words per API call</label>
                <span className="pricing-param-value">{wordsPerCall}</span>
              </div>
              <input type="range" className="pricing-range" min={50} max={5000} step={50} value={wordsPerCall} onChange={e => setWordsPerCall(parseInt(e.target.value))} />
            </div>
            <div className="pricing-param">
              <div className="pricing-param-header">
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)' }}>System prompt tokens</label>
                <span className="pricing-param-value">{systemPromptTokens}</span>
              </div>
              <input type="range" className="pricing-range" min={50} max={2000} step={50} value={systemPromptTokens} onChange={e => setSystemPromptTokens(parseInt(e.target.value))} />
            </div>
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Provider filter</div>
              <div className="filter-chips">
                {allProviders.map(p => (
                  <button
                    key={p}
                    className={`filter-chip${enabledProviders.has(p) ? ' active' : ''}`}
                    onClick={() => toggleProvider(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>

      <p className="pricing-disclaimer">
        Prices are API list prices per 1M tokens, refreshed automatically from provider pricing data. Actual costs vary by pricing tier, caching, batching, and model version. Always verify current pricing on provider documentation.
      </p>

      <div className="pricing-results-section">
        <div className="pricing-results-header">
          <span className="pricing-results-label">{results.length} models</span>
          <button className="pricing-sort-toggle" onClick={() => setSortAsc(v => !v)}>
            {sortAsc ? '↑ Cheapest first' : '↓ Most expensive first'}
          </button>
        </div>
        {totalWords === 0 ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--space-8) 0' }}>
            Add language pairs with word volumes to see cost estimates.
          </p>
        ) : (
          <div className="pricing-results-list">
            <div className="pricing-list-header">
              <span className="pricing-list-col-rank">#</span>
              <span className="pricing-list-col-name">Model</span>
              <span className="pricing-list-col-cost">Est. cost/mo</span>
              <span className="pricing-list-col-rates">Input · Output / 1M tok</span>
              <span className="pricing-list-col-ctx">Context</span>
            </div>
            {results.map((m, i) => {
              const colors = PROVIDER_COLORS[m.provider] ?? { bg: 'var(--warm-soft)', text: 'var(--warm-strong)' }
              return (
                <div key={m.id} className="pricing-list-row">
                  <span className="pricing-list-rank">{i + 1}</span>
                  <span className="pricing-list-name">
                    <span className="pricing-list-model">{m.name}</span>
                    <span className="pricing-provider-chip" style={{ background: colors.bg, color: colors.text }}>{m.provider}</span>
                  </span>
                  <span className="pricing-list-cost">${m.monthlyCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="pricing-list-rates">${m.input} · ${m.output}</span>
                  <span className="pricing-list-ctx">{formatCtx(m.context)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
