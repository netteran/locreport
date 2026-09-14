// Digest composition: turns the period's articles plus one subscriber's
// preferences into the blocks digestEmail() renders. Pure — no DB, no Resend —
// so it can be exercised on its own.
import { SIGNAL_MAP } from '@/lib/signals'
import { articleHref } from '@/lib/utils'
import { DigestArticle, DigestSection } from '@/lib/email/templates'
import { SITE_URL } from '@/lib/email/send'

export interface DigestSourceArticle {
  id: string
  title: string
  slug: string
  excerpt: string | null
  impact_score: number | null
  signal_ids: string[] | null
  business_implications: string[] | null
  published_at: string
}

export interface DigestPrefs {
  /** Signals the subscriber wants a dedicated briefing section for. */
  signalPrefs: string[]
  /** Whether to also carry the general roundup of everything in the period. */
  includeSummary: boolean
  /** Impact floor, applied to every block. */
  minImpact: number
}

/** How many leftover stories the closing list carries in each mode. */
const ROUNDUP_LIMIT = 12
const SIGNAL_TAIL_LIMIT = 6
/** Stories per signal briefing. */
const SECTION_LIMIT = 4

export function toDigestArticle(a: DigestSourceArticle): DigestArticle {
  return {
    id: a.id,
    title: a.title,
    url: `${SITE_URL}${articleHref(a.slug)}`,
    excerpt: a.excerpt,
    impact_score: a.impact_score,
    business_implications: a.business_implications,
  }
}

// Which of the period's articles this subscriber asked for: the whole period if
// they keep the general summary, otherwise only what carries a signal they
// follow. Impact is a floor on both.
export function selectForSubscriber(
  articles: DigestSourceArticle[],
  { signalPrefs, includeSummary, minImpact }: DigestPrefs
): DigestSourceArticle[] {
  return articles.filter(a => {
    if ((a.impact_score ?? 0) < minImpact) return false
    if (includeSummary) return true
    return (a.signal_ids ?? []).some(sid => signalPrefs.includes(sid))
  })
}

// Top story → one section per followed signal → the leftover list, from a set
// of articles already narrowed by selectForSubscriber.
export function composeDigest(
  articles: DigestSourceArticle[],
  { signalPrefs, includeSummary }: DigestPrefs
) {
  const byImpact = [...articles].sort(
    (a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0) || b.published_at.localeCompare(a.published_at)
  )
  const topStory = byImpact[0] ?? null
  const used = new Set<string>(topStory ? [topStory.id] : [])

  // Signal briefings, busiest signal first. A subscriber who follows no
  // signals gets no sections — their digest is the roundup alone.
  const followed = signalPrefs
    .filter(sid => SIGNAL_MAP.has(sid))
    .map(sid => ({ sid, articles: byImpact.filter(a => (a.signal_ids ?? []).includes(sid)) }))
    .filter(s => s.articles.length > 0)
    .sort((a, b) => b.articles.length - a.articles.length)

  const sections: DigestSection[] = []
  for (const { sid, articles: sigArticles } of followed) {
    const fresh = sigArticles.filter(a => !used.has(a.id)).slice(0, SECTION_LIMIT)
    if (fresh.length === 0) continue
    fresh.forEach(a => used.add(a.id))
    sections.push({ heading: SIGNAL_MAP.get(sid)!.title, articles: fresh.map(toDigestArticle) })
  }

  // Everything not already shown: the rest of the period for summary
  // subscribers, the tail of their signals for briefing-only ones.
  const leftovers = byImpact.filter(a => !used.has(a.id))
  return {
    topStory: topStory ? toDigestArticle(topStory) : null,
    sections,
    roundup: leftovers.slice(0, includeSummary ? ROUNDUP_LIMIT : SIGNAL_TAIL_LIMIT).map(toDigestArticle),
    roundupHeading: includeSummary ? 'The week in brief' : 'More in your signals',
  }
}
