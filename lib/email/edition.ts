import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Issue } from './digest'
import type { DigestCompany, DigestMarket } from './templates'
import { buildIssue } from './issue'
import { weeklyEditionDate } from './weeklyNote'
import { marked } from 'marked'
import { articleHref, contentTypeFromPath, type PostReference } from '@/lib/contentTaxonomy'
import { canonicalLegacyArticleSlug } from '@/lib/legacyArticleSlugs'
import { canonicalMonthlyReportSlug } from '@/lib/monthlyReportSlugs'
import { SITE_URL } from './send'

export const EDITION_MIGRATION = '20261124_weekly_newsletter_editions.sql'
export const EDITION_BODY_LIMIT = 60000
export interface EditionCopy { subject: string; body_markdown: string }
export interface SavedEdition extends EditionCopy { edition_date: string; article_ids: string[]; updated_at?: string }
export function editionRevision(copy: EditionCopy, editionDate: string) {
  return createHash('sha256').update(JSON.stringify([editionDate, copy.subject, copy.body_markdown])).digest('hex')
}
export function normalizeEdition(input: { subject?: unknown; body_markdown?: unknown }): EditionCopy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Supply a subject and newsletter content.')
  if (typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 200 || /[\r\n]/.test(input.subject)) throw new Error('Use a subject of 1–200 characters on one line.')
  if (typeof input.body_markdown !== 'string' || !input.body_markdown.trim() || input.body_markdown.length > EDITION_BODY_LIMIT) throw new Error(`Use 1–${EDITION_BODY_LIMIT} characters for the newsletter content.`)
  return { subject: input.subject.trim(), body_markdown: input.body_markdown.replace(/\r\n?/g, '\n').trim() }
}
export function missingEditions(error: { code?: string; message?: string } | null) {
  return !!error && ['42P01', 'PGRST205'].includes(error.code || '') && /\bweekly_newsletter_editions\b/.test(error.message || '')
}
export async function loadEdition(service: SupabaseClient, date: string, allowMissing = false): Promise<SavedEdition | null> {
  const { data, error } = await service.from('weekly_newsletter_editions').select('edition_date,subject,body_markdown,article_ids,updated_at').eq('edition_date', date).maybeSingle()
  if (error) {
    if (allowMissing && missingEditions(error)) return null
    throw new Error(missingEditions(error) ? `Apply ${EDITION_MIGRATION} to enable full newsletter editing.` : error.message)
  }
  if (!data) return null
  return { ...data, ...normalizeEdition(data), article_ids: data.article_ids || [] }
}
function plain(value: string | null | undefined) { return (value || '').replace(/([\\`*_{}\[\]<>!#|])/g, '\\$1') }
function link(label: string, url: string) { return `[${plain(label)}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` }
function signedPercent(value: number) { return `${value > 0 ? '+' : ''}${value.toFixed(1)}%` }
export function companySectionMarkdown(c: DigestCompany): string {
  return `## Company of the week\n\n${link(c.name, c.url)}${c.logoUrl ? `\n\n![${plain(c.name)}](${c.logoUrl})` : ''}\n\n${[c.category, c.hq, c.founded ? `est. ${c.founded}` : null].filter(Boolean).map(v => plain(String(v))).join(' · ')}\n\n${plain(c.blurb)}\n\n${link('See the profile on LocReport →', c.url)}`
}

export function marketSectionMarkdown(m: DigestMarket): string {
  return `## LocStock\n\nThe ${m.tracked} language services companies with usable prices moved **${signedPercent(m.avgPct)}** on average this week. Biggest moves:\n\n${m.movers.map(v => `- **${plain(v.symbol)}** ${plain(v.name)} **${signedPercent(v.pct)}**`).join('\n')}\n\n${link('Open LocStock →', m.url)}`
}

export function issueMarkdown(issue: Issue): string {
  const sections: string[] = []
  if (issue.editorNote) sections.push(issue.editorNote)
  if (issue.topStory) {
    const a = issue.topStory
    sections.push(`## Top story\n\n${link(a.title, a.url)}${a.excerpt ? `\n\n${plain(a.excerpt)}` : ''}${a.business_implications?.length ? '\n\n**Why it matters**\n\n' + a.business_implications.map(p => `- ${plain(p)}`).join('\n') : ''}\n\n${link('Read the story →', a.url)}`)
  }
  if (issue.company) sections.push(companySectionMarkdown(issue.company))
  if (issue.facts.length) sections.push('## Fact Flow\n\n' + issue.facts.map(f => `- ${link(f.content, f.url)}`).join('\n'))
  if (issue.market) sections.push(marketSectionMarkdown(issue.market))
  if (issue.directory.length) sections.push('## New in the directory\n\n' + issue.directory.map(c => `${link(c.name, c.url)}${c.category ? ` · ${plain(c.category)}` : ''}\n\n${plain(c.description)}`).join('\n\n'))
  if (issue.more.length) sections.push('## More from LocReport\n\n' + issue.more.map(a => `- ${link(a.title, a.url)}`).join('\n'))
  if (issue.moreCount) sections.push(link(`Browse ${issue.moreCount} more articles`, `${SITE_URL}/`))
  return sections.join('\n\n')
}
export async function linkedArticleIds(service: SupabaseClient, markdown: string): Promise<string[]> {
  const routes = new Set<string>()
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type !== 'link' || routes.size >= 200) return
    try {
      const url = new URL(token.href, SITE_URL)
      if (!['http:', 'https:'].includes(url.protocol) || !['locreport.com', 'www.locreport.com'].includes(url.hostname)
        || url.port || url.username || url.password) return
      const [section, ...parts] = url.pathname.split('/').filter(Boolean)
      const type = contentTypeFromPath(section)
      if (section !== 'articles' && (!type || parts.length !== 1)) return
      const slug = decodeURIComponent(parts.at(-1) ?? '').toLowerCase().replace(/\.html$/, '')
      if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,239}$/u.test(slug)) return
      const target = canonicalLegacyArticleSlug(slug)
      const canonical = section === 'articles' || type === 'report' ? canonicalMonthlyReportSlug(target) : target
      routes.add(`${section}/${canonical}`)
    } catch { /* Ignore malformed URLs in the working copy. */ }
  })
  const slugs = [...new Set([...routes].map(route => route.split('/')[1]))]
  const articleIds = new Set<string>()
  for (let from = 0; from < slugs.length; from += 40) {
    const { data, error } = await service.from('public_article_index')
      .select('id,slug,article_type,content_type,content_slug')
      .in('content_slug', slugs.slice(from, from + 40))
      .returns<(PostReference & { id: string })[]>()
    if (error) throw new Error(`Could not resolve newsletter article links: ${error.message}`)
    for (const article of data ?? []) {
      const path = decodeURIComponent(articleHref(article)).slice(1, -1)
      if (routes.has(path) || routes.has(`articles/${article.content_slug}`)) articleIds.add(article.id)
    }
  }
  return [...articleIds]
}
export async function resolveEdition(service: SupabaseClient, periodStart: Date, periodEnd: Date) {
  const editionDate = weeklyEditionDate(periodEnd)
  const saved = await loadEdition(service, editionDate, true)
  if (saved) return { editionDate, subject: saved.subject, bodyMarkdown: saved.body_markdown,
    revision: editionRevision(saved, editionDate), issue: { storyCount: saved.article_ids.length, articleIds: saved.article_ids } }
  const { issue, error } = await buildIssue(service, periodStart, periodEnd)
  if (error) throw new Error(error)
  return { editionDate, subject: issue?.topStory ? `The Weekly: ${issue.topStory.title}` : 'The Weekly from LocReport',
    bodyMarkdown: null, revision: null, issue }
}
