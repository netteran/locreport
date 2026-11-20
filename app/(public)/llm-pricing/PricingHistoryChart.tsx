'use client'
import { useState, useMemo, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { LLMModel, ModelPriceHistory } from '@/lib/data/llm-pricing'

interface Props {
  models: LLMModel[]
  history: ModelPriceHistory[]
}

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
  '#84cc16', '#6366f1', '#14b8a6', '#e11d48',
]

type TokenType = 'input' | 'output'
type ViewMode = 'absolute' | 'pct'

function buildChartData(
  selectedIds: string[],
  history: ModelPriceHistory[],
  tokenType: TokenType,
  viewMode: ViewMode,
) {
  const historyMap = new Map(history.map(h => [h.modelId, h]))

  const allDates = new Set<string>()
  for (const id of selectedIds) {
    const h = historyMap.get(id)
    if (h) h.snapshots.forEach(s => allDates.add(s.date))
  }
  const sortedDates = [...allDates].sort()
  if (sortedDates.length === 0) return []

  const today = new Date().toISOString().slice(0, 10)
  if (sortedDates[sortedDates.length - 1] < today) sortedDates.push(today)

  // For % mode: find each model's baseline (first snapshot price)
  const baselines: Record<string, number> = {}
  for (const id of selectedIds) {
    const h = historyMap.get(id)
    if (!h || h.snapshots.length === 0) continue
    const first = [...h.snapshots].sort((a, b) => a.date.localeCompare(b.date))[0]
    baselines[id] = tokenType === 'input' ? first.input : first.output
  }

  return sortedDates.map(date => {
    const point: Record<string, string | number> = { date }
    for (const id of selectedIds) {
      const h = historyMap.get(id)
      if (!h) continue
      const snap = [...h.snapshots]
        .filter(s => s.date <= date)
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1)
      if (snap) {
        const raw = tokenType === 'input' ? snap.input : snap.output
        if (viewMode === 'pct') {
          const base = baselines[id]
          point[id] = base ? Math.round(((raw - base) / base) * 100) : 0
        } else {
          point[id] = raw
        }
      }
    }
    return point
  })
}

function formatDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// Collect all dates where ANY model had a price change (for reference lines)
function getChangeEvents(history: ModelPriceHistory[], selectedIds: string[]) {
  const dates = new Set<string>()
  for (const id of selectedIds) {
    const h = history.find(h => h.modelId === id)
    if (!h) continue
    h.snapshots.forEach(s => dates.add(s.date))
  }
  return [...dates].sort()
}

// Compute total % change from first to last snapshot for a model
function computeTotalChange(history: ModelPriceHistory[], id: string, tokenType: TokenType) {
  const h = history.find(h => h.modelId === id)
  if (!h || h.snapshots.length < 2) return null
  const sorted = [...h.snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const first = tokenType === 'input' ? sorted[0].input : sorted[0].output
  const last = tokenType === 'input' ? sorted[sorted.length - 1].input : sorted[sorted.length - 1].output
  return Math.round(((last - first) / first) * 100)
}

function ShareButton() {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}#price-history`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])

  return (
    <button
      className="phc-share-btn"
      onClick={handleCopy}
      title="Copy link to this section"
      aria-label="Share price history section"
    >
      {copied ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
          Share
        </>
      )}
    </button>
  )
}

export function PricingHistoryChart({ models, history }: Props) {
  const [tokenType, setTokenType] = useState<TokenType>('input')
  const [viewMode, setViewMode] = useState<ViewMode>('absolute')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(models.slice(0, 5).map(m => m.id))
  )

  const modelMap = useMemo(() => new Map(models.map(m => [m.id, m])), [models])

  function toggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { if (next.size > 1) next.delete(id) }
      else next.add(id)
      return next
    })
  }

  const selected = [...selectedIds]
  const chartData = useMemo(
    () => buildChartData(selected, history, tokenType, viewMode),
    [selected, history, tokenType, viewMode]
  )

  const changeEvents = useMemo(
    () => getChangeEvents(history, selected),
    [history, selected]
  )

  // Models that have multi-snapshot history (show change badge)
  const movers = useMemo(() =>
    selected
      .map(id => {
        const pct = computeTotalChange(history, id, tokenType)
        return { id, pct, name: modelMap.get(id)?.name ?? id }
      })
      .filter(m => m.pct !== null)
      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)),
    [selected, history, tokenType, modelMap]
  )

  const providers = [...new Set(models.map(m => m.provider))]

  const yTickFormatter = (v: number) =>
    viewMode === 'pct' ? `${v > 0 ? '+' : ''}${v}%` : `$${v}`

  const tooltipFormatter = (value: number | string | undefined, name: string) => {
    const label = modelMap.get(name)?.name ?? name
    if (value == null) return ['-', label]
    if (viewMode === 'pct') {
      const n = Number(value)
      return [`${n > 0 ? '+' : ''}${n}% vs launch`, label]
    }
    return [`$${value}/1M`, label]
  }

  return (
    <div id="price-history" className="phc-root">
      <div className="phc-header">
        <div className="phc-header-left">
          <div className="phc-title-row">
            <h2 className="phc-title">Price history</h2>
            <ShareButton />
          </div>
          <p className="phc-subtitle">
            {viewMode === 'pct'
              ? 'Cumulative % change from each model\'s launch price — the AI price war in one view.'
              : 'API list price per 1M tokens over time. Select models to compare.'}
          </p>
        </div>
        <div className="phc-controls">
          <div className="phc-toggle-group">
            <button
              className={`phc-toggle-btn${tokenType === 'input' ? ' active' : ''}`}
              onClick={() => setTokenType('input')}
            >Input</button>
            <button
              className={`phc-toggle-btn${tokenType === 'output' ? ' active' : ''}`}
              onClick={() => setTokenType('output')}
            >Output</button>
          </div>
          <div className="phc-toggle-group">
            <button
              className={`phc-toggle-btn${viewMode === 'absolute' ? ' active' : ''}`}
              onClick={() => setViewMode('absolute')}
            >$ Price</button>
            <button
              className={`phc-toggle-btn phc-toggle-btn--pct${viewMode === 'pct' ? ' active' : ''}`}
              onClick={() => setViewMode('pct')}
            >% Change</button>
          </div>
        </div>
      </div>

      {/* Price movers strip */}
      {movers.length > 0 && (
        <div className="phc-movers">
          <span className="phc-movers-label">Price changes</span>
          {movers.map(m => (
            <span
              key={m.id}
              className={`phc-mover-badge${(m.pct ?? 0) < 0 ? ' drop' : ' rise'}`}
            >
              {m.name}
              <strong>{(m.pct ?? 0) > 0 ? '+' : ''}{m.pct}%</strong>
            </span>
          ))}
        </div>
      )}

      <div className="phc-model-picker">
        {providers.map(provider => (
          <div key={provider} className="phc-provider-group">
            <div className="phc-provider-label">{provider}</div>
            <div className="phc-chips">
              {models.filter(m => m.provider === provider).map((m) => {
                const colorIdx = models.indexOf(m) % PALETTE.length
                const isActive = selectedIds.has(m.id)
                const pct = computeTotalChange(history, m.id, tokenType)
                return (
                  <button
                    key={m.id}
                    className={`phc-chip${isActive ? ' active' : ''}`}
                    style={isActive ? {
                      borderColor: PALETTE[colorIdx],
                      color: PALETTE[colorIdx],
                      background: PALETTE[colorIdx] + '18',
                    } : {}}
                    onClick={() => toggle(m.id)}
                  >
                    {m.name}
                    {pct !== null && (
                      <span className={`phc-chip-delta${pct < 0 ? ' down' : ' up'}`}>
                        {pct > 0 ? '+' : ''}{pct}%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="phc-chart-wrap">
        {chartData.length < 2 ? (
          <div className="phc-empty">Not enough historical data for selected models.</div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top: 12, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              {/* Reference lines at every price-change event */}
              {changeEvents.slice(0, -1).map(date => (
                <ReferenceLine
                  key={date}
                  x={date}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  label={{
                    value: formatDate(date),
                    position: 'insideTopRight',
                    fontSize: 10,
                    fill: 'var(--muted)',
                    dy: -4,
                  }}
                />
              ))}
              {viewMode === 'pct' && (
                <ReferenceLine
                  y={0}
                  stroke="var(--muted)"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{
                    value: 'Launch price',
                    position: 'insideBottomLeft',
                    fontSize: 10,
                    fill: 'var(--muted)',
                  }}
                />
              )}
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 12, fill: 'var(--muted)' }}
                minTickGap={50}
              />
              <YAxis
                tickFormatter={yTickFormatter}
                tick={{ fontSize: 12, fill: 'var(--muted)' }}
                width={58}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={tooltipFormatter as any}
                labelFormatter={(label) => formatDate(String(label))}
                contentStyle={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
              <Legend
                formatter={(value) => modelMap.get(value)?.name ?? value}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              {selected.map((id) => (
                <Line
                  key={id}
                  type="stepAfter"
                  dataKey={id}
                  stroke={PALETTE[models.findIndex(m => m.id === id) % PALETTE.length]}
                  strokeWidth={2.5}
                  dot={{ r: 5, strokeWidth: 2 }}
                  connectNulls={false}
                  activeDot={{ r: 7 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="phc-disclaimer">
        Snapshots reflect announced API list prices at point of change, refreshed automatically — verify against provider documentation for accuracy.
      </p>
    </div>
  )
}
