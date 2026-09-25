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

const IMPACT_LABEL: Record<number, string> = { 1: 'Routine', 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shell(bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.surface};border-radius:12px;border:1px solid ${BRAND.border};overflow:hidden;">
        <tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${BRAND.border};">
          <a href="https://locreport.com" style="text-decoration:none;">
            <img src="${LOGO_URL}" alt="LocReport" width="128" height="34" style="display:block;height:34px;width:auto;border:0;outline:none;text-decoration:none;">
          </a>
        </td></tr>
        <tr><td style="padding:28px 32px;">
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
  impact_score?: number | null
  business_implications?: string[] | null
}

export interface DigestStats {
  stories: number
  highImpact: number
  /** Signals rising or newly covered this week. */
  risingSignals: number
  activeSignals: number
  totalSignals: number
}

export interface DigestSignalMove {
  id: string
  label: string
  url: string
  /** Articles tagged with the signal this week. */
  count: number
  /** Weekly average over the baseline weeks before this one. */
  priorAvg: number
  trend: 'new' | 'up' | 'steady' | 'down' | 'quiet'
  /** Had at least one story a week on average before going quiet. */
  wasActive: boolean
  lead: DigestArticle | null
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

export interface DigestDirectoryEntry {
  name: string
  category: string | null
  description: string | null
  url: string
}

const TREND: Record<DigestSignalMove['trend'], { mark: string; label: string; color: string }> = {
  new: { mark: '●', label: 'New this month', color: BRAND.gold },
  up: { mark: '▲', label: 'Rising', color: '#1E7F4F' },
  steady: { mark: '■', label: 'Steady', color: BRAND.muted },
  down: { mark: '▼', label: 'Cooling', color: '#B3261E' },
  quiet: { mark: '○', label: 'Quiet', color: BRAND.muted },
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

export function digestEmail({ periodLabel, stats, topStory, signalMoves, facts, market, directory, more, moreCount, unsubscribeUrl }: {
  periodLabel: string
  stats: DigestStats
  topStory: DigestArticle | null
  signalMoves: DigestSignalMove[]
  facts: DigestFact[]
  market: DigestMarket | null
  directory: DigestDirectoryEntry[]
  more: DigestArticle[]
  moreCount: number
  unsubscribeUrl: string
}): string {
  const statCell = (value: string | number, label: string) => `
    <td width="33%" style="padding:12px 8px;text-align:center;background:${BRAND.bg};border-radius:8px;">
      <div style="font-size:20px;font-weight:700;color:${BRAND.text};">${value}</div>
      <div style="font-size:11px;color:${BRAND.muted};margin-top:2px;">${escapeHtml(label)}</div>
    </td>`
  const statsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:6px 0;margin:0 -6px 24px;">
      <tr>
        ${statCell(stats.stories, stats.stories === 1 ? 'story' : 'stories')}
        ${stats.highImpact > 0 ? statCell(stats.highImpact, 'high-impact') : statCell(stats.risingSignals, stats.risingSignals === 1 ? 'signal rising' : 'signals rising')}
        ${statCell(`${stats.activeSignals}/${stats.totalSignals}`, 'signals active')}
      </tr>
    </table>`

  const topHtml = topStory ? `
    ${eyebrow(`Top story${topStory.impact_score ? ` · ${IMPACT_LABEL[topStory.impact_score] ?? ''} impact` : ''}`, BRAND.gold)}
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

  const active = signalMoves.filter(m => m.count > 0)
  const quiet = signalMoves.filter(m => m.count === 0)
  const signalsHtml = `
    ${eyebrow('Signal movement', BRAND.accent)}
    <p style="margin:-4px 0 14px;font-size:12px;line-height:1.5;color:${BRAND.muted};">This week’s coverage of every signal we track, against its weekly average over the previous four weeks.</p>
    ${active.map(m => {
      const t = TREND[m.trend]
      return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr>
          <td width="18" valign="top" style="font-size:12px;line-height:20px;color:${t.color};">${t.mark}</td>
          <td valign="top">
            <p style="margin:0;font-size:14px;line-height:20px;">
              <a href="${m.url}" style="color:${BRAND.text};font-weight:600;text-decoration:none;">${escapeHtml(m.label)}</a>
              <span style="font-size:12px;color:${t.color};font-weight:600;"> · ${t.label}</span>
              <span style="font-size:12px;color:${BRAND.muted};"> · ${m.count} ${m.count === 1 ? 'story' : 'stories'} (avg ${m.priorAvg}/wk)</span>
            </p>
            ${m.lead ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.5;"><a href="${m.lead.url}" style="color:${BRAND.muted};text-decoration:underline;text-decoration-color:${BRAND.border};">${escapeHtml(m.lead.title)}</a></p>` : ''}
          </td>
        </tr>
      </table>`
    }).join('')}
    ${quiet.length ? `<p style="margin:4px 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted};"><strong style="color:${BRAND.text};">${TREND.quiet.mark} Quiet this week:</strong> ${quiet.map(m => `<a href="${m.url}" style="color:${BRAND.muted};">${escapeHtml(m.label)}</a>${m.wasActive ? ' (usually active)' : ''}`).join(', ')}</p>` : ''}
    ${RULE}`

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
        ${a.impact_score && a.impact_score >= 4 ? `<span style="font-size:10px;font-weight:700;color:${BRAND.gold};letter-spacing:0.06em;">${escapeHtml((IMPACT_LABEL[a.impact_score] ?? '').toUpperCase())}</span> ` : ''}<a href="${a.url}" style="color:${BRAND.text};text-decoration:underline;text-decoration-color:${BRAND.border};">${escapeHtml(a.title)}</a>
      </p>`).join('')}
    ${moreCount > 0 ? `<a href="https://locreport.com/articles" style="display:inline-block;margin-top:4px;font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:none;">+ ${moreCount} more on LocReport →</a>` : ''}` : ''

  const body = `
    <p style="margin:0 0 16px;font-size:13px;color:${BRAND.muted};">The Weekly · ${escapeHtml(periodLabel)}</p>
    ${statsHtml}
    ${topHtml}
    ${signalsHtml}
    ${factsHtml}
    ${marketHtml}
    ${directoryHtml}
    ${moreHtml}`

  const footer = `
    You're receiving this because you subscribed to The Weekly from LocReport.<br>
    <a href="${unsubscribeUrl}" style="color:${BRAND.muted};">Unsubscribe</a><br>
    LocReport · locreport.com`
  return shell(body, footer)
}
