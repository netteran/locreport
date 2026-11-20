import { Lexer, type Token } from 'marked'

// Inline-styled HTML email builders. Email clients can't read CSS variables,
// so brand values from assets/css/style.css are hardcoded here as hex.

const BRAND = {
  accent: '#3550F5',
  text: '#182F54',
  muted: '#465C79',
  bg: '#F2F7FF',
  masthead: '#E5F1FF',
  story: '#FFF8E8',
  storyRule: '#F2B84B',
  storyLabel: '#80520F',
  company: '#EDF9F4',
  panel: '#F1F7FF',
  surface: '#FFFFFF',
  border: '#D9E6F3',
}

// Direct asset URL (not the Next.js image optimizer) — email clients need a
// stable, cacheable URL. logolight.png is the dark logo intended for the
// light email header.
const LOGO_URL = 'https://locreport.com/logolight.png'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline Markdown only: emit our own tags and never pass through source HTML. */
function inlineMarkdown(markdown: string, { linkStyle = `color:${BRAND.accent};text-decoration:underline;`, linkArrow = false, financial = false } = {}): string {
  function render(tokens: Token[], insideLink = false): string {
    return tokens.map(token => {
      switch (token.type) {
        case 'strong':
          return `<strong>${render(token.tokens || [], insideLink)}</strong>`
        case 'em':
          return `<em>${render(token.tokens || [], insideLink)}</em>`
        case 'link': {
          const label = render(token.tokens || [], true)
          if (insideLink) return label
          let url: URL
          try { url = new URL(token.href) } catch { return label }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return label
          return `<a href="${escapeHtml(url.href)}" style="${linkStyle}">${label}${linkArrow ? `&nbsp;<span aria-hidden="true" style="color:${BRAND.accent};font-weight:600;">→</span>` : ''}</a>`
        }
        case 'escape':
          return escapeHtml(token.raw.slice(1))
        default:
          // Token text is already entity-escaped by marked. Escape the raw
          // source instead to preserve literal ampersands and existing copy.
          // HTML, images and other unsupported markup remain visible text.
          return financial && token.type === 'text'
            ? escapeHtml(token.raw).replace(/[+−-]?\d+(?:\.\d+)?%/g, value => `<span style="color:${Number(value.replace('%', '').replace('−', '-')) < 0 ? '#B3261E' : '#1E7F4F'};font-weight:600;">${value}</span>`)
            : escapeHtml(token.raw)
      }
    }).join('')
  }
  return render(Lexer.lexInline(markdown.trim(), { gfm: true }))
}

export function renderWeeklyNote(markdown: string): string {
  return inlineMarkdown(markdown)
}

/** Render note blocks without allowing source HTML or unsupported block tags. */
export function renderWeeklyNoteContent(markdown: string): string {
  const paragraph = (content: string) =>
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.65;color:${BRAND.text};">${content}</p>`
  return Lexer.lex(markdown.trim(), { gfm: true }).map(token => {
    switch (token.type) {
      case 'space': return ''
      case 'heading': {
        const level = Math.max(1, Math.min(6, token.depth))
        const size = [24, 21, 18, 16, 15, 14][level - 1]
        return `<h${level} style="margin:0 0 12px;font-size:${size}px;line-height:1.3;font-weight:700;color:${BRAND.text};">${renderWeeklyNote(token.text)}</h${level}>`
      }
      case 'paragraph': return paragraph(renderWeeklyNote(token.text))
      default: return paragraph(escapeHtml(token.raw.trim()))
    }
  }).join('')
}

interface WeeklyLinks {
  manageUrl?: string
  browserUrl?: string
}

function weeklyEmail(periodLabel: string, bodyHtml: string, { manageUrl, browserUrl }: WeeklyLinks): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Weekly · LocReport</title>
<style>
@media only screen and (max-width:480px){
  .newsletter-frame{padding:8px 8px 20px!important}
  .newsletter-masthead,.newsletter-content,.newsletter-footer{padding-right:18px!important;padding-left:18px!important}
  .newsletter-masthead h1{font-size:36px!important}
  .newsletter-lead{padding:18px!important}
  .newsletter-story-title{font-size:25px!important}
}
</style></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:${FONT};color:${BRAND.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};">
    <tr><td class="newsletter-frame" align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" align="center" width="620" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BRAND.surface}" style="max-width:620px;width:100%;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;table-layout:fixed;font-family:${FONT};">
        <tr><td bgcolor="${BRAND.masthead}" class="newsletter-masthead" style="background:${BRAND.masthead};padding:25px 36px 30px;border-top:4px solid ${BRAND.accent};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td valign="middle">
              <a href="https://locreport.com" style="display:inline-block;color:${BRAND.text};text-decoration:none;">
                <img src="${LOGO_URL}" alt="LocReport" width="112" height="32" style="display:block;width:112px;height:32px;border:0;color:${BRAND.text};">
              </a>
            </td>${browserUrl ? `<td align="right" valign="middle">
              <a href="${escapeHtml(browserUrl)}" style="color:${BRAND.muted};font-size:13px;line-height:1.35;text-decoration:underline;">View in browser</a>
            </td>` : ''}</tr>
          </table>
          <h1 style="margin:14px 0 5px;color:${BRAND.text};font-size:42px;line-height:1.1;font-weight:700;letter-spacing:-0.035em;">The Weekly</h1>
          <p style="margin:0;color:${BRAND.muted};font-size:14px;line-height:1.45;">${escapeHtml(periodLabel)}</p>
        </td></tr>
        <tr><td class="newsletter-content" style="padding:28px 35px 12px;overflow-wrap:break-word;word-wrap:break-word;">
          ${bodyHtml}
        </td></tr>
        <tr><td class="newsletter-footer" bgcolor="${BRAND.panel}" style="padding:22px 35px;background:${BRAND.panel};border-top:1px solid ${BRAND.border};font-size:13px;line-height:1.55;color:${BRAND.muted};">
          <p style="margin:0 0 7px;font-weight:700;color:${BRAND.text};">LocReport</p>
          ${manageUrl ? `<p style="margin:0 0 9px;">You’re receiving The Weekly because you subscribed to LocReport.</p>
          <a href="${escapeHtml(manageUrl)}" style="color:${BRAND.accent};text-decoration:underline;">Manage subscription</a>` :
          `<a href="https://locreport.com" style="color:${BRAND.accent};text-decoration:underline;">Visit LocReport</a>`}
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`
}

const CONFIRM = { ...BRAND, text: '#1D1D1F', muted: '#6E6E73', bg: '#F5F5F7', border: '#E5E5EA' }

function confirmEmailShell(bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>@media only screen and (max-width:480px){.newsletter-header,.newsletter-content{padding:24px 20px!important;}}</style></head>
<body style="margin:0;padding:0;background:${CONFIRM.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${CONFIRM.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CONFIRM.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CONFIRM.surface};border-radius:12px;border:1px solid ${CONFIRM.border};overflow:hidden;">
        <tr><td class="newsletter-header" style="padding:28px 32px 20px;border-bottom:1px solid ${CONFIRM.border};">
          <a href="https://locreport.com" style="text-decoration:none;">
            <img src="${LOGO_URL}" alt="LocReport" width="128" height="34" style="display:block;height:34px;width:auto;border:0;outline:none;text-decoration:none;">
          </a>
        </td></tr>
        <tr><td class="newsletter-content" style="padding:28px 32px;overflow-wrap:break-word;word-wrap:break-word;">
          ${bodyHtml}
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:20px 32px;font-size:12px;line-height:1.6;color:${CONFIRM.muted};text-align:center;">
          ${footerHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function confirmEmail({ confirmUrl }: { confirmUrl: string }): string {
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;letter-spacing:-0.01em;">One click and you’re in</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${CONFIRM.muted};">
      You asked to join The Weekly — what’s moving in translation, localization
      and language AI, and what it means for your work. Confirm below and the
      next issue is yours.
    </p>
    <a href="${confirmUrl}" style="display:inline-block;background:${CONFIRM.accent};color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
      Confirm and join
    </a>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:${CONFIRM.muted};">
      If you didn't request this, ignore this email and nothing will be sent.
    </p>`
  const footer = `LocReport · locreport.com — The pulse of the language services industry`
  return confirmEmailShell(body, footer)
}

export interface DigestArticle {
  id: string
  title: string
  url: string
  excerpt?: string | null
  business_implications?: string[] | null
}

export interface DigestFact {
  content: string
  url: string
}

export interface DigestMarket {
  avgPct: number
  tracked: number
  movers: { symbol: string; name: string; pct: number }[]
  url: string
}

export interface DigestCompany {
  name: string
  /** The company's LocReport directory profile. */
  url: string
  /** Only set when the logo is a format email clients render (PNG/JPEG/GIF). */
  logoUrl: string | null
  category: string | null
  hq: string | null
  founded: number | null
  /** Two or three sentences on what the company does. */
  blurb: string
}

export interface DigestDirectoryEntry {
  name: string
  category: string | null
  description: string | null
  url: string
}

function eyebrow(text: string, color: string = BRAND.accent): string {
  return `<p style="margin:0 0 10px;font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${color};">${escapeHtml(text)}</p>`
}

const RULE = `<hr style="border:none;border-top:1px solid ${BRAND.border};margin:24px 0;">`

const STORY_TITLE = 'margin:0 0 12px;font-size:30px;line-height:1.17;letter-spacing:-0.025em;font-weight:700;'
const STORY_CTA = `display:inline-block;padding:10px 16px;background:${BRAND.accent};border:1px solid ${BRAND.accent};border-radius:6px;color:#FFFFFF;font-size:14px;line-height:1.4;font-weight:700;text-decoration:none;`
const TITLE_LINK = `color:${BRAND.text};text-decoration:none;`
const CTA_LINK = `color:${BRAND.accent};text-decoration:underline;font-weight:650;`
const MORE_LINK = `color:${BRAND.text};text-decoration:underline;font-weight:600;`

function panel(content: string, kind: 'lead' | 'company' | 'support'): string {
  const lead = kind === 'lead'
  const color = lead ? BRAND.story : kind === 'company' ? BRAND.company : BRAND.panel
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${color}" style="background:${color};border:1px solid ${BRAND.border};border-radius:9px;table-layout:fixed;">
    <tr><td${lead ? ' class="newsletter-lead"' : ''} style="padding:${lead ? '24' : '18'}px;${lead ? `border-top:3px solid ${BRAND.storyRule};` : ''}">${content}</td></tr>
  </table>`
}

function weeklySection(heading: string, kind: NewsletterSection, content: string): string {
  const label = kind === 'custom' ? '' : `<h2 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${BRAND.text};">${escapeHtml(heading)}</h2>`
  const block = kind === 'story' ? panel(eyebrow(heading, BRAND.storyLabel) + content, 'lead') : label + content
  return `<div data-newsletter-section="${kind}" style="margin:0 0 26px;">${block}</div>`
}

function editorIntro(content: string): string {
  return `<div style="margin:0 0 24px;">${eyebrow('From the editor', BRAND.muted)}${content}</div>`
}

function companyHeader(nameHtml: string, metadataHtml: string, logo: { url: string; alt: string } | null, initial: string): string {
  const mark = logo
    ? `<img src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.alt)}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;border:0;">`
    : `<span aria-hidden="true" style="display:block;text-align:center;color:${BRAND.accent};font-size:24px;font-weight:700;line-height:56px;">${escapeHtml(initial)}</span>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;margin:0 0 12px;"><tr>
    <td valign="middle" width="56" bgcolor="${BRAND.surface}" style="width:56px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:8px;">${mark}</td>
    <td valign="middle" style="padding-left:13px;overflow-wrap:break-word;word-wrap:break-word;">
      <p style="margin:0;font-size:18px;font-weight:700;line-height:1.3;">${nameHtml}</p>
      ${metadataHtml ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.4;color:${BRAND.muted};">${metadataHtml}</p>` : ''}
    </td>
  </tr></table>`
}

function pct(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s
}

export function digestEmail({ periodLabel, editorNote, topStory, company, facts, market, directory, more, moreCount, ...links }: WeeklyLinks & {
  periodLabel: string
  editorNote?: string
  topStory: DigestArticle | null
  company: DigestCompany | null
  facts: DigestFact[]
  market: DigestMarket | null
  directory: DigestDirectoryEntry[]
  more: DigestArticle[]
  moreCount: number
}): string {
  const topHtml = topStory ? weeklySection('Top story', 'story', `
    <h2 class="newsletter-story-title" style="${STORY_TITLE}"><a href="${escapeHtml(topStory.url)}" style="${TITLE_LINK}">${escapeHtml(topStory.title)}</a></h2>
    ${topStory.excerpt ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${BRAND.muted};">${escapeHtml(topStory.excerpt)}</p>` : ''}
    ${topStory.business_implications?.length ? `
      <p style="margin:0 0 5px;font-size:14px;font-weight:700;color:${BRAND.text};">Why it matters</p>
      <ul style="margin:0 0 14px;padding-left:21px;font-size:15px;line-height:1.5;color:${BRAND.text};">
        ${topStory.business_implications.slice(0, 2).map(point => `<li style="margin-bottom:5px;">${escapeHtml(point)}</li>`).join('')}
      </ul>` : ''}
    <a href="${escapeHtml(topStory.url)}" style="${STORY_CTA}">Read the story →</a>`) : ''

  const companyHtml = company ? weeklySection('Company of the week', 'company', panel(`
    ${companyHeader(
      `<a href="${escapeHtml(company.url)}" style="${TITLE_LINK}">${escapeHtml(company.name)}</a>`,
      escapeHtml([company.category, company.hq, company.founded ? `est. ${company.founded}` : null].filter(Boolean).join(' · ')),
      company.logoUrl ? { url: company.logoUrl, alt: `${company.name} logo` } : null,
      company.name.charAt(0).toUpperCase(),
    )}
    <p style="margin:0 0 10px;font-size:15px;line-height:1.55;">${escapeHtml(company.blurb)}</p>
    <a href="${escapeHtml(company.url)}" style="${CTA_LINK}">See the profile on LocReport →</a>`, 'company')) : ''

  const factsHtml = facts.length ? weeklySection('Fact Flow', 'facts', `
    <ul style="list-style:none;margin:0;padding:0;font-size:15px;line-height:1.55;">
      ${facts.map(f => `<li style="margin:0 0 11px;padding-left:12px;border-left:2px solid ${BRAND.accent};">
        <a href="${escapeHtml(f.url)}" style="${TITLE_LINK}">${escapeHtml(f.content)}&nbsp;<span aria-hidden="true" style="color:${BRAND.accent};font-weight:700;">→</span></a>
      </li>`).join('')}
    </ul>`) : ''

  const marketHtml = market ? weeklySection('LocStock brief', 'market', panel(`
    <p style="margin:0 0 10px;font-size:14px;line-height:1.5;">
      The ${market.tracked} language services companies with usable prices moved <strong style="color:${market.avgPct >= 0 ? '#1E7F4F' : '#B3261E'};">${pct(market.avgPct)}</strong> on average this week. Biggest moves:
    </p>
    ${market.movers.map(m => `
      <p style="margin:0 0 5px;font-size:14px;line-height:1.55;">
        <strong>${escapeHtml(m.symbol)}</strong> <span style="color:${BRAND.muted};">${escapeHtml(m.name)}</span>
        <span style="color:${m.pct >= 0 ? '#1E7F4F' : '#B3261E'};font-weight:700;"> ${pct(m.pct)}</span>
      </p>`).join('')}
    <a href="${escapeHtml(market.url)}" style="display:inline-block;margin-top:7px;${CTA_LINK}">Open LocStock →</a>`, 'support')) : ''

  const directoryHtml = directory.length ? weeklySection('New in the directory', 'directory', directory.map(d => `
    <p style="margin:0 0 4px;font-size:15px;font-weight:700;line-height:1.5;">
      <a href="${escapeHtml(d.url)}" style="${MORE_LINK}">${escapeHtml(d.name)}</a>
      ${d.category ? `<span style="font-size:13px;font-weight:400;color:${BRAND.muted};"> · ${escapeHtml(d.category)}</span>` : ''}
    </p>
    ${d.description ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${BRAND.muted};">${escapeHtml(truncate(d.description, 160))}</p>` : ''}`).join('')) : ''

  const moreHtml = more.length ? weeklySection('More from LocReport', 'more', `
    ${more.map(a => `<p style="margin:0 0 9px;font-size:15px;line-height:1.5;">
      <a href="${escapeHtml(a.url)}" style="${MORE_LINK}">${escapeHtml(a.title)}</a>
    </p>`).join('')}
    ${moreCount > 0 ? `<a href="https://locreport.com/articles" style="${CTA_LINK}">+ ${moreCount} more on LocReport →</a>` : ''}`) : ''

  return weeklyEmail(periodLabel, `
    ${editorNote?.trim() ? editorIntro(renderWeeklyNoteContent(editorNote)) : ''}
    ${topHtml}${companyHtml}${factsHtml}${marketHtml}${directoryHtml}${moreHtml}`, links)
}

type NewsletterSection = 'story' | 'company' | 'facts' | 'market' | 'directory' | 'more' | 'custom'
const SECTION_TYPES: Record<string, NewsletterSection> = {
  'top story': 'story',
  'company of the week': 'company',
  'fact flow': 'facts',
  'fact flow · the week in five facts': 'facts',
  'locstock': 'market',
  'locstock brief': 'market',
  'new in the directory': 'directory',
  'more from locreport': 'more',
  'everything else this week': 'more',
}

function standaloneImage(token: Token) {
  const image = token.type === 'paragraph' && token.tokens?.length === 1 && token.tokens[0].type === 'image' ? token.tokens[0] : null
  if (!image) return null
  try {
    const url = new URL(image.href)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return { url: url.href, alt: image.text }
  } catch { /* Unsupported destinations remain escaped text. */ }
  return null
}

/** Style the saved document itself; never regenerate or replace an editor's copy. */
export function editedDigestEmail({ editionDate, bodyMarkdown, ...links }: WeeklyLinks & { editionDate: string; bodyMarkdown: string }): string {
  const p = (s: string, style = '') => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${BRAND.text};${style}">${s}</p>`
  function blocks(tokens: Token[], section: NewsletterSection = 'custom', nested = false): string {
    let titleSeen = false
    let ctaSeen = false
    return tokens.map(token => {
      switch (token.type) {
        case 'space': return ''
        case 'heading': {
          const level = Math.max(1, Math.min(6, token.depth))
          return `<h${level} style="margin:20px 0 10px;font-size:${[24, 21, 18, 16, 15, 14][level - 1]}px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${BRAND.text};">${renderWeeklyNote(token.text)}</h${level}>`
        }
        case 'text':
        case 'paragraph': {
          const inlineTokens: Token[] | undefined = 'tokens' in token ? token.tokens : undefined
          const image = standaloneImage(token)
          if (image) {
            return `<p style="margin:12px 0;"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="120" style="display:block;max-width:120px;height:auto;border:0;"></p>`
          }
          const singleLink = inlineTokens?.length === 1 && inlineTokens[0].type === 'link'
          if (!nested && singleLink && section === 'story' && !titleSeen) {
            titleSeen = true
            return `<h2 class="newsletter-story-title" style="${STORY_TITLE}">${inlineMarkdown(token.text, { linkStyle: TITLE_LINK })}</h2>`
          }
          if (!nested && inlineTokens?.[0]?.type === 'link' && section === 'directory') return p(inlineMarkdown(token.text, { linkStyle: MORE_LINK }), 'margin-bottom:4px;font-weight:700;')
          if (singleLink && nested && section === 'facts') return p(inlineMarkdown(token.text, { linkStyle: TITLE_LINK, linkArrow: true }), 'margin:0;font-size:15px;')
          if (singleLink && nested && section === 'more') return p(inlineMarkdown(token.text, { linkStyle: MORE_LINK }), 'margin:0;font-size:15px;')
          if (singleLink && !nested && section === 'story' && !ctaSeen) {
            ctaSeen = true
            return p(inlineMarkdown(token.text, { linkStyle: STORY_CTA }), 'margin-bottom:0;')
          }
          if (singleLink && !nested && ['company', 'market', 'more'].includes(section)) return p(inlineMarkdown(token.text, { linkStyle: CTA_LINK }), 'margin-bottom:0;font-size:14px;')
          if (!nested && section === 'story' && inlineTokens?.length === 1 && inlineTokens[0].type === 'strong') return p(renderWeeklyNote(token.text), 'margin:12px 0 4px;font-size:14px;')
          const muted = !nested && ['story', 'directory'].includes(section)
          return p(inlineMarkdown(token.text, { financial: section === 'market' }), `${nested ? 'margin:0 0 4px;font-size:15px;' : ''}${muted || (nested && section === 'story') ? `color:${BRAND.muted};` : ''}`)
        }
        case 'list': {
          const tag = token.ordered ? 'ol' : 'ul'
          const start = token.ordered && token.start ? ` start="${Number(token.start)}"` : ''
          const callouts = !nested && !token.ordered && section === 'facts'
          const compact = !nested && !token.ordered && ['market', 'more'].includes(section)
          const itemStyle = callouts ? `margin:0 0 12px;padding-left:12px;border-left:2px solid ${BRAND.accent};` : `margin:0 0 ${compact ? 8 : 6}px;`
          return `<${tag}${start} style="${callouts || compact ? 'list-style:none;padding:0;' : 'padding-left:22px;'}margin:8px 0 16px;font-size:13px;line-height:1.55;">${token.items.map((item: { tokens: Token[] }) => `<li style="${itemStyle}">${blocks(item.tokens, section, true)}</li>`).join('')}</${tag}>`
        }
        case 'blockquote': return `<blockquote style="margin:16px 0;padding:4px 0 4px 16px;border-left:2px solid ${BRAND.accent};">${blocks(token.tokens || [], section, true)}</blockquote>`
        case 'hr': return RULE
        default: return p(escapeHtml(token.raw))
      }
    }).join('')
  }

  function companyCard(tokens: Token[]) {
    const content = tokens.filter(token => token.type !== 'space')
    const title = content[0]
    const image = content[1] && standaloneImage(content[1])
    // Generated editions put the company name first and its optional logo next.
    // Freely authored sections still get the card without imposing this shape.
    const titleLink = title?.type === 'paragraph' && title.tokens?.length === 1 ? title.tokens[0] : null
    const hasTitle = title?.type === 'paragraph' && titleLink?.type === 'link'
    let bodyStart = hasTitle ? (image ? 2 : 1) : 0
    const next = content[bodyStart]
    const metadata = hasTitle && next?.type === 'paragraph' && next.text.includes(' · ') ? next : null
    if (metadata) bodyStart++
    const header = hasTitle ? companyHeader(
      inlineMarkdown(title.text, { linkStyle: TITLE_LINK }),
      metadata ? renderWeeklyNote(metadata.text) : '',
      image ?? null,
      titleLink.text.trim().charAt(0).toUpperCase(),
    ) : ''
    return panel(header + blocks(content.slice(bodyStart), 'company'), 'company')
  }

  const sections: { heading?: Token & { type: 'heading'; text: string; depth: number }; tokens: Token[] }[] = [{ tokens: [] }]
  for (const token of Lexer.lex(bodyMarkdown, { gfm: true })) {
    if (token.type === 'heading' && token.depth === 2) sections.push({ heading: { ...token, type: 'heading', text: token.text, depth: token.depth }, tokens: [] })
    else sections[sections.length - 1].tokens.push(token)
  }
  const content = sections.map(({ heading, tokens }) => {
    if (!heading) {
      const lead = blocks(tokens)
      return lead ? editorIntro(lead) : ''
    }
    const kind = SECTION_TYPES[heading.text.trim().toLowerCase()] || 'custom'
    if (kind === 'company') return weeklySection(heading.text, kind, companyCard(tokens))
    const body = blocks(kind === 'custom' ? [heading, ...tokens] : tokens, kind)
    return weeklySection(heading.text, kind, kind === 'market' ? panel(body, 'support') : body)
  }).join('')
  const date = new Date(`${editionDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' })
  return weeklyEmail(date, content, links)
}
