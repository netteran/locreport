import { Lexer, type Token } from 'marked'

// Inline-styled HTML email builders. Email clients can't read CSS variables,
// so brand values from assets/css/style.css are hardcoded here as hex.

const BRAND = {
  accent: '#3550F5',
  gold: '#B5740F',
  text: '#1D1D1F',
  muted: '#6E6E73',
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  border: '#E5E5EA',
}

// Direct asset URL (not the Next.js image optimizer) — email clients need a
// stable, cacheable URL. logolight.png is the dark logo intended for the
// light email header.
const LOGO_URL = 'https://locreport.com/logolight.png'

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
          return `<a href="${escapeHtml(url.href)}" style="${linkStyle}">${label}${linkArrow ? ` <span aria-hidden="true" style="color:${BRAND.accent};font-weight:600;">→</span>` : ''}</a>`
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
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:${BRAND.text};">${content}</p>`
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

function shell(bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>@media only screen and (max-width:480px){.newsletter-header,.newsletter-content{padding:24px 20px!important;}}</style></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.surface};border-radius:12px;border:1px solid ${BRAND.border};overflow:hidden;">
        <tr><td class="newsletter-header" style="padding:28px 32px 20px;border-bottom:1px solid ${BRAND.border};">
          <a href="https://locreport.com" style="text-decoration:none;">
            <img src="${LOGO_URL}" alt="LocReport" width="128" height="34" style="display:block;height:34px;width:auto;border:0;outline:none;text-decoration:none;">
          </a>
        </td></tr>
        <tr><td class="newsletter-content" style="padding:28px 32px;overflow-wrap:break-word;word-wrap:break-word;">
          ${bodyHtml}
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:20px 32px;font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
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
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.muted};">
      You asked to join The Weekly — what’s moving in translation, localization
      and language AI, and what it means for your work. Confirm below and the
      next issue is yours.
    </p>
    <a href="${confirmUrl}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
      Confirm and join
    </a>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
      If you didn't request this, ignore this email and nothing will be sent.
    </p>`
  const footer = `LocReport · locreport.com — The pulse of the language services industry`
  return shell(body, footer)
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

function eyebrow(text: string, color: string = BRAND.muted): string {
  return `<p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${color};">${escapeHtml(text)}</p>`
}

const RULE = `<hr style="border:none;border-top:1px solid ${BRAND.border};margin:24px 0;">`

function pct(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s
}

export function digestEmail({ periodLabel, editorNote, topStory, company, facts, market, directory, more, moreCount, manageUrl }: {
  periodLabel: string
  editorNote?: string
  topStory: DigestArticle | null
  company: DigestCompany | null
  facts: DigestFact[]
  market: DigestMarket | null
  directory: DigestDirectoryEntry[]
  more: DigestArticle[]
  moreCount: number
  /** The subscriber's /subscribe/manage page — where unsubscribing lives. */
  manageUrl: string
}): string {
  const topHtml = topStory ? `
    ${eyebrow('Top story', BRAND.gold)}
    <h2 style="margin:0 0 8px;font-size:19px;line-height:1.3;letter-spacing:-0.01em;">
      <a href="${topStory.url}" style="color:${BRAND.text};text-decoration:none;">${escapeHtml(topStory.title)}</a>
    </h2>
    ${topStory.excerpt ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(topStory.excerpt)}</p>` : ''}
    ${topStory.business_implications?.length ? `
      <p style="margin:12px 0 4px;font-size:12px;font-weight:700;color:${BRAND.text};">Why it matters</p>
      ${topStory.business_implications.slice(0, 2).map(b => `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:${BRAND.muted};">• ${escapeHtml(b)}</p>`).join('')}
    ` : ''}
    <a href="${topStory.url}" style="display:inline-block;margin-top:8px;font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:none;">Read the story →</a>
    ${RULE}` : ''

  const companyHtml = company ? (() => {
    const logo = company.logoUrl
      ? `<img src="${escapeHtml(company.logoUrl)}" alt="${escapeHtml(company.name)} logo" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;border:0;">`
      : `<div style="width:56px;height:56px;line-height:56px;text-align:center;font-size:24px;font-weight:700;color:${BRAND.accent};">${escapeHtml(company.name.charAt(0).toUpperCase())}</div>`
    const meta = [company.category, company.hq, company.founded ? `est. ${company.founded}` : null].filter(Boolean).join(' · ')
    return `
    ${eyebrow('Company of the week', BRAND.accent)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;">
      <tr><td style="padding:18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
          <tr>
            <td valign="middle" style="width:64px;">
              <a href="${company.url}" style="display:block;width:64px;height:64px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:10px;padding:4px;box-sizing:border-box;text-decoration:none;">${logo}</a>
            </td>
            <td valign="middle" style="padding-left:14px;">
              <p style="margin:0;font-size:17px;font-weight:700;line-height:1.3;"><a href="${company.url}" style="color:${BRAND.text};text-decoration:none;">${escapeHtml(company.name)}</a></p>
              ${meta ? `<p style="margin:2px 0 0;font-size:12px;color:${BRAND.muted};">${escapeHtml(meta)}</p>` : ''}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${BRAND.text};">${escapeHtml(company.blurb)}</p>
        <a href="${company.url}" style="font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:none;">See the profile on LocReport →</a>
      </td></tr>
    </table>
    ${RULE}`
  })() : ''

  const factsHtml = facts.length ? `
    ${eyebrow('Fact Flow · the week in five facts')}
    ${facts.map(f => `
      <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:${BRAND.text};padding-left:12px;border-left:2px solid ${BRAND.accent};">
        ${escapeHtml(f.content)} <a href="${f.url}" style="color:${BRAND.accent};text-decoration:none;font-weight:600;">→</a>
      </p>`).join('')}
    ${RULE}` : ''

  const marketHtml = market ? `
    ${eyebrow('LocStock brief')}
    <p style="margin:0 0 10px;font-size:14px;line-height:1.5;">
      The ${market.tracked} companies we track moved <strong style="color:${market.avgPct >= 0 ? '#1E7F4F' : '#B3261E'};">${pct(market.avgPct)}</strong> on average this week. Biggest moves:
    </p>
    ${market.movers.map(m => `
      <p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:${BRAND.text};">
        <strong>${escapeHtml(m.symbol)}</strong> <span style="color:${BRAND.muted};">${escapeHtml(m.name)}</span>
        <span style="color:${m.pct >= 0 ? '#1E7F4F' : '#B3261E'};font-weight:600;"> ${pct(m.pct)}</span>
      </p>`).join('')}
    <a href="${market.url}" style="display:inline-block;margin-top:6px;font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:none;">Open LocStock →</a>
    ${RULE}` : ''

  const directoryHtml = directory.length ? `
    ${eyebrow('New in the directory')}
    ${directory.map(d => `
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;line-height:1.4;">
        <a href="${d.url}" style="color:${BRAND.text};text-decoration:none;">${escapeHtml(d.name)}</a>
        ${d.category ? `<span style="font-size:11px;font-weight:400;color:${BRAND.muted};"> · ${escapeHtml(d.category)}</span>` : ''}
      </p>
      ${d.description ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${BRAND.muted};">${escapeHtml(truncate(d.description, 160))}</p>` : '<p style="margin:0 0 10px;"></p>'}`).join('')}
    ${RULE}` : ''

  const moreHtml = more.length ? `
    ${eyebrow('Everything else this week')}
    ${more.map(a => `
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;">
        <a href="${a.url}" style="color:${BRAND.text};text-decoration:underline;text-decoration-color:${BRAND.border};">${escapeHtml(a.title)}</a>
      </p>`).join('')}
    ${moreCount > 0 ? `<a href="https://locreport.com/articles" style="display:inline-block;margin-top:4px;font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:none;">+ ${moreCount} more on LocReport →</a>` : ''}` : ''

  const body = `
    <p style="margin:0 0 16px;font-size:13px;color:${BRAND.muted};">The Weekly · ${escapeHtml(periodLabel)}</p>
    ${editorNote?.trim() ? `<div style="margin:0 0 24px;">${renderWeeklyNoteContent(editorNote)}</div>` : ''}
    ${topHtml}
    ${companyHtml}
    ${factsHtml}
    ${marketHtml}
    ${directoryHtml}
    ${moreHtml}`

  const footer = `
    You're receiving this because you subscribed to The Weekly from LocReport.<br>
    <a href="${manageUrl}" style="color:${BRAND.muted};">Manage subscription</a><br>
    LocReport · locreport.com`
  return shell(body, footer)
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
const TITLE_LINK = `color:${BRAND.text};text-decoration:none;`
const CTA_LINK = `color:${BRAND.accent};text-decoration:none;font-weight:600;`
const MORE_LINK = `color:${BRAND.text};text-decoration:underline;text-decoration-color:${BRAND.border};`

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
export function editedDigestEmail({ editionDate, bodyMarkdown, manageUrl }: { editionDate: string; bodyMarkdown: string; manageUrl: string }): string {
  const p = (s: string, style = '') => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${BRAND.text};${style}">${s}</p>`
  function blocks(tokens: Token[], section: NewsletterSection = 'custom', nested = false): string {
    let titleSeen = false
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
            return `<h2 style="margin:0 0 8px;font-size:19px;line-height:1.3;letter-spacing:-0.01em;font-weight:700;">${inlineMarkdown(token.text, { linkStyle: TITLE_LINK })}</h2>`
          }
          if (!nested && inlineTokens?.[0]?.type === 'link' && section === 'directory') return p(inlineMarkdown(token.text, { linkStyle: TITLE_LINK }), 'margin-bottom:4px;font-weight:600;')
          if (singleLink && nested && section === 'facts') return p(inlineMarkdown(token.text, { linkStyle: TITLE_LINK, linkArrow: true }), 'margin:0;font-size:13px;')
          if (singleLink && nested && section === 'more') return p(inlineMarkdown(token.text, { linkStyle: MORE_LINK }), 'margin:0;font-size:13px;')
          if (singleLink && !nested && ['story', 'company', 'market', 'more'].includes(section)) return p(inlineMarkdown(token.text, { linkStyle: CTA_LINK }), 'font-size:13px;')
          if (!nested && section === 'story' && inlineTokens?.length === 1 && inlineTokens[0].type === 'strong') return p(renderWeeklyNote(token.text), 'margin:12px 0 4px;font-size:12px;')
          const muted = !nested && ['story', 'directory'].includes(section)
          return p(inlineMarkdown(token.text, { financial: section === 'market' }), `${nested ? 'margin:0 0 4px;font-size:13px;' : ''}${muted || (nested && section === 'story') ? `color:${BRAND.muted};` : ''}`)
        }
        case 'list': {
          const tag = token.ordered ? 'ol' : 'ul'
          const start = token.ordered && token.start ? ` start="${Number(token.start)}"` : ''
          const callouts = !nested && !token.ordered && section === 'facts'
          const compact = !nested && !token.ordered && ['market', 'more'].includes(section)
          const itemStyle = callouts ? `margin:0 0 12px;padding-left:12px;border-left:2px solid ${BRAND.accent};` : `margin:0 0 ${compact ? 8 : 6}px;`
          return `<${tag}${start} style="${callouts || compact ? 'list-style:none;padding:0;' : 'padding-left:22px;'}margin:8px 0 16px;font-size:13px;line-height:1.6;">${token.items.map((item: { tokens: Token[] }) => `<li style="${itemStyle}">${blocks(item.tokens, section, true)}</li>`).join('')}</${tag}>`
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
    const hasTitle = title?.type === 'paragraph' && title.tokens?.length === 1 && title.tokens[0].type === 'link'
    let bodyStart = hasTitle ? (image ? 2 : 1) : 0
    const next = content[bodyStart]
    const metadata = hasTitle && next?.type === 'paragraph' && next.text.includes(' · ') ? next : null
    if (metadata) bodyStart++
    const header = hasTitle ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;table-layout:fixed;"><tr>
      ${image ? `<td valign="middle" width="64" style="width:64px;padding-right:14px;"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;box-sizing:border-box;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:8px;padding:4px;"></td>` : ''}
      <td valign="middle" style="overflow-wrap:break-word;">${p(inlineMarkdown(title.text, { linkStyle: TITLE_LINK }), 'margin:0;font-size:17px;font-weight:700;line-height:1.3;')}${metadata ? p(renderWeeklyNote(metadata.text), `margin:2px 0 0;font-size:12px;color:${BRAND.muted};`) : ''}</td></tr></table>` : ''
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;table-layout:fixed;"><tr><td style="padding:18px;">${header}${blocks(content.slice(bodyStart), 'company')}</td></tr></table>`
  }

  const sections: { heading?: Token & { type: 'heading'; text: string; depth: number }; tokens: Token[] }[] = [{ tokens: [] }]
  for (const token of Lexer.lex(bodyMarkdown, { gfm: true })) {
    if (token.type === 'heading' && token.depth === 2) sections.push({ heading: { ...token, type: 'heading', text: token.text, depth: token.depth }, tokens: [] })
    else sections[sections.length - 1].tokens.push(token)
  }
  const content = sections.map(({ heading, tokens }) => {
    if (!heading) return tokens.length ? `<div style="margin:0 0 24px;">${blocks(tokens)}</div>` : ''
    const kind = SECTION_TYPES[heading.text.trim().toLowerCase()] || 'custom'
    const label = kind === 'custom' ? blocks([heading]) : eyebrow(heading.text, kind === 'story' ? BRAND.gold : kind === 'company' ? BRAND.accent : BRAND.muted)
    // Section containers and rules preserve the original newsletter's visual rhythm.
    return `<div data-newsletter-section="${kind}">${label}${kind === 'company' ? companyCard(tokens) : blocks(tokens, kind)}</div>${kind === 'more' ? '' : RULE}`
  }).join('')
  const date = new Date(`${editionDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' })
  return shell(`<p style="margin:0 0 16px;font-size:13px;color:${BRAND.muted};">The Weekly · ${escapeHtml(date)}</p>${content}`,
    `You're receiving The Weekly from LocReport.<br><a href="${escapeHtml(manageUrl)}" style="color:${BRAND.muted};">Manage subscription</a><br>LocReport · locreport.com`)
}
