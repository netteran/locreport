import type { SupabaseClient } from '@supabase/supabase-js'

export type CompanyArticle = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  publisher: string | null
  published_at: string
}

export type CompanyCoverage = {
  /** The company is named in the article's title or excerpt — the article is about it. */
  coverage: CompanyArticle[]
  /** Named only in the body — a passing mention, a citation, a competitor. */
  mentions: CompanyArticle[]
}

const COLUMNS = 'id, title, slug, excerpt, publisher, published_at'

/**
 * Postgres (ARE) pattern matching the company name as a whole word,
 * case-sensitively — the same rule linkifyCompanyMentions() uses to link a
 * mention to the profile, so the profile lists what the articles link from.
 * Case matters: "Phrase" the company vs "phrase" the word, "GALA" vs "gala".
 * `\m`/`\M` only make sense next to a word character, so a name that starts or
 * ends with punctuation gets no boundary on that side.
 */
function namePattern(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = /^\w/.test(name) ? '\\m' : ''
  const end = /\w$/.test(name) ? '\\M' : ''
  return `${start}${escaped}${end}`
}

function byNewest(a: CompanyArticle, b: CompanyArticle) {
  return b.published_at.localeCompare(a.published_at)
}

/**
 * Every article that names a directory company, split by how central the
 * company is to it. Monthly reports are left out, as on the signal pages: they
 * name dozens of companies in passing and would top every list.
 *
 * Decorative on the profile page — any failure returns empty lists rather than
 * failing the profile.
 */
export async function getCompanyArticles(supabase: SupabaseClient, name: string): Promise<CompanyCoverage> {
  const empty: CompanyCoverage = { coverage: [], mentions: [] }
  if (!name.trim()) return empty
  const pattern = namePattern(name.trim())

  // One query per column rather than an .or(): names like "ProZ.com" or
  // "Phoenix & Flag" would need quoting inside PostgREST's or() syntax, while a
  // plain filter value is passed through as-is.
  const query = (column: 'title' | 'excerpt' | 'content') =>
    supabase
      .from('articles')
      .select(COLUMNS)
      .filter(column, 'match', pattern)
      .neq('article_type', 'monthly-summary')
      .order('published_at', { ascending: false })

  try {
    const [inTitle, inExcerpt, inBody] = await Promise.all([query('title'), query('excerpt'), query('content')])
    if (inTitle.error || inExcerpt.error || inBody.error) {
      console.error('[companyArticles]', name, inTitle.error ?? inExcerpt.error ?? inBody.error)
      return empty
    }

    const coverage = new Map<string, CompanyArticle>()
    for (const a of [...(inTitle.data ?? []), ...(inExcerpt.data ?? [])] as CompanyArticle[]) {
      coverage.set(a.id, a)
    }
    const mentions = ((inBody.data ?? []) as CompanyArticle[]).filter(a => !coverage.has(a.id))

    return { coverage: [...coverage.values()].sort(byNewest), mentions }
  } catch (err) {
    console.error('[companyArticles]', name, err)
    return empty
  }
}
