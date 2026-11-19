'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export interface FilterState {
  topic: string
  impact: string
  category: string
  from: string
  to: string
  sort: string
}

export default function ArticlesFilter({ filters, shownCount, totalCount }: {
  filters: FilterState
  shownCount: number
  totalCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [filterOpen, setFilterOpen] = useState(false)

  // Legacy deep links used #quality etc. — promote them to the topic param.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (['quality', 'operations', 'governance', 'market', 'strategy'].includes(hash) && filters.topic === 'all') {
      const params = new URLSearchParams(searchParams.toString())
      params.set('topic', hash)
      router.replace(`${pathname}?${params.toString()}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setParam(key: string, value: string, defaultValue = 'all') {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === defaultValue) params.delete(key)
    else params.set(key, value)
    params.delete('page') // any filter change restarts pagination
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function clearAll() {
    router.push(pathname, { scroll: false })
  }

  const activeBadge = [
    filters.topic !== 'all',
    filters.impact !== 'all',
    filters.category !== 'all',
    !!filters.from,
    !!filters.to,
  ].filter(Boolean).length

  return (
    <section className={`all-articles-filter-bar${filterOpen ? ' is-open' : ''}`}>
      <button
        className="filter-bar-toggle"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen(o => !o)}
      >
        <span className="filter-bar-toggle-left">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="filter-bar-toggle-label">Filters</span>
          {activeBadge > 0 && (
            <span className="filter-bar-toggle-badge">{activeBadge}</span>
          )}
        </span>
        <svg className="filter-bar-toggle-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="filter-bar-collapsible">
        <div className="filter-bar-inner">
          <div className="filter-group">
            <label className="filter-label" htmlFor="topic-select">Topic</label>
            <select className="filter-select" id="topic-select" value={filters.topic} onChange={e => setParam('topic', e.target.value)}>
              <option value="all">All topics</option>
              <option value="quality">Quality</option>
              <option value="operations">Operations</option>
              <option value="governance">Governance</option>
              <option value="market">Market</option>
              <option value="strategy">Strategy</option>
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="category-filter">Category</label>
            <select className="filter-select" id="category-filter" value={filters.category} onChange={e => setParam('category', e.target.value)}>
              <option value="all">All categories</option>
              <option value="industry">Analysis</option>
              <option value="monthly-summary">Monthly Report</option>
              <option value="annual">Archived annual reports</option>
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="date-from">From</label>
            <input type="date" className="filter-select filter-date" id="date-from" value={filters.from} onChange={e => setParam('from', e.target.value, '')} />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor="date-to">To</label>
            <input type="date" className="filter-select filter-date" id="date-to" value={filters.to} onChange={e => setParam('to', e.target.value, '')} />
          </div>
          <div className="filter-group filter-group--sort">
            <label className="filter-label" htmlFor="sort-select">Sort</label>
            <select className="filter-select" id="sort-select" value={filters.sort} onChange={e => setParam('sort', e.target.value, 'date')}>
              <option value="date">Newest first</option>
              <option value="oldest">Oldest first</option>
              {filters.sort === 'impact' && <option value="impact">Legacy order</option>}
            </select>
          </div>
        </div>
        <div className="filter-status-row">
          <button className="filter-reset-btn" onClick={clearAll}>Clear all</button>
          <p className="filter-count" aria-live="polite">
            {shownCount === totalCount
              ? `${totalCount} articles`
              : `${shownCount} of ${totalCount} articles`}
          </p>
        </div>
      </div>
    </section>
  )
}
