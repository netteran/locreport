'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { isArticlePath } from '@/lib/contentTaxonomy'

export function ReadingProgress() {
  const [pct, setPct] = useState(0)
  const pathname = usePathname()
  const isArticle = isArticlePath(pathname)

  useEffect(() => {
    if (!isArticle) { setPct(0); return }

    let ticking = false

    function update() {
      ticking = false
      const article = document.querySelector('article.post') as HTMLElement | null
      if (!article) return
      const top = article.getBoundingClientRect().top + window.scrollY
      const total = article.offsetHeight - window.innerHeight
      const scrolled = window.scrollY - top
      const p = total > 0 ? Math.min(100, Math.max(0, (scrolled / total) * 100)) : 0
      setPct(p)
    }

    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [isArticle, pathname])

  if (!isArticle) return null

  return (
    <div
      className="read-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label="Reading progress"
      style={{ width: `${pct}%` }}
    />
  )
}
