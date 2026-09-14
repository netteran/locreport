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
    <h1 style="margin:0 0 12px;font-size:22px;letter-spacing:-0.01em;">Confirm your subscription</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.muted};">
      You asked to receive the LocReport digest — curated language-industry
      intelligence with impact scoring and signal tracking. Click below to confirm.
    </p>
    <a href="${confirmUrl}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
      Confirm subscription
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

export interface DigestSection {
  heading: string
  articles: DigestArticle[]
}

export function digestEmail({ periodLabel, topStory, sections, roundup, roundupHeading, manageUrl, unsubscribeUrl }: {
  periodLabel: string
  topStory: DigestArticle | null
  sections: DigestSection[]
  roundup: DigestArticle[]
  roundupHeading: string
  manageUrl: string
  unsubscribeUrl: string
}): string {
  const topHtml = topStory ? `
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.gold};">Top story${topStory.impact_score ? ` · ${IMPACT_LABEL[topStory.impact_score] ?? ''} impact` : ''}</p>
    <h2 style="margin:0 0 8px;font-size:19px;line-height:1.3;letter-spacing:-0.01em;">
      <a href="${topStory.url}" style="color:${BRAND.text};text-decoration:none;">${escapeHtml(topStory.title)}</a>
    </h2>
    ${topStory.excerpt ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(topStory.excerpt)}</p>` : ''}
    ${topStory.business_implications?.length ? `
      <p style="margin:12px 0 4px;font-size:12px;font-weight:700;color:${BRAND.text};">Why it matters</p>
      ${topStory.business_implications.slice(0, 2).map(b => `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;color:${BRAND.muted};">• ${escapeHtml(b)}</p>`).join('')}
    ` : ''}
    <a href="${topStory.url}" style="display:inline-block;margin-top:8px;font-size:13px;font-weight:600;color:${BRAND.accent};text-decoration:none;">Read the story →</a>
    <hr style="border:none;border-top:1px solid ${BRAND.border};margin:24px 0;">` : ''

  const sectionsHtml = sections.map(section => `
    <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.accent};">${escapeHtml(section.heading)}</p>
    ${section.articles.map(a => `
      <p style="margin:0 0 2px;font-size:15px;font-weight:600;line-height:1.4;">
        <a href="${a.url}" style="color:${BRAND.text};text-decoration:none;">${escapeHtml(a.title)}</a>
      </p>
      ${a.excerpt ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:${BRAND.muted};">${escapeHtml(a.excerpt.length > 180 ? a.excerpt.slice(0, 180) + '…' : a.excerpt)}</p>` : '<p style="margin:0 0 12px;"></p>'}
    `).join('')}
    <hr style="border:none;border-top:1px solid ${BRAND.border};margin:16px 0 24px;">`).join('')

  const roundupHtml = roundup.length ? `
    <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.muted};">${escapeHtml(roundupHeading)}</p>
    ${roundup.map(a => `
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;">
        <a href="${a.url}" style="color:${BRAND.text};text-decoration:underline;text-decoration-color:${BRAND.border};">${escapeHtml(a.title)}</a>
      </p>`).join('')}` : ''

  const body = `
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.muted};">Your language-industry intelligence digest · ${escapeHtml(periodLabel)}</p>
    ${topHtml}
    ${sectionsHtml}
    ${roundupHtml}`

  const footer = `
    You're receiving this because you subscribed to the LocReport digest.<br>
    <a href="${manageUrl}" style="color:${BRAND.muted};">Manage preferences</a> ·
    <a href="${unsubscribeUrl}" style="color:${BRAND.muted};">Unsubscribe</a><br>
    LocReport · locreport.com`
  return shell(body, footer)
}
