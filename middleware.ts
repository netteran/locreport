import { NextResponse, type NextRequest } from 'next/server'
import { resolvePublicArticle } from '@/lib/articleLookup'
import { articleHref, contentTypeFromPath } from '@/lib/contentTaxonomy'
import { MONTHLY_REPORT_EDITIONS } from '@/lib/monthlyReportSlugs'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'

const dateParts = /^\d{4}\/\d{2}\/\d{2}\//
const knownMonths = new Map(MONTHLY_REPORT_EDITIONS.flatMap(({ year, number, month, slug }) => [
  [`monthly/${year}/${number}`, slug],
  [`monthly-report-${month.toLowerCase()}-${year}`, slug],
]))
const knownReports = new Set(ANNUAL_REPORTS.map(report => report.slug))

function redirect(request: NextRequest, path: string, status: 301 | 308 = 301, preserveQuery = false) {
  const url = new URL(path, request.url)
  if (preserveQuery) url.search = new URL(request.url).search
  return NextResponse.redirect(url, status)
}

function legacyArticlePath(path: string) {
  const unprefixed = path.replace(/^\/(?:articles|translation|language-science)\//, '').replace(/^\//, '')
  const isLegacy = /^\/(?:articles|language-science)\//.test(path) || dateParts.test(unprefixed)
  if (!isLegacy) return null
  const decoded = unprefixed.split('/').map(segment => decodeURIComponent(segment))
  const last = decoded.length - 1
  decoded[last] = decoded[last].replace(/\.html$/i, '')
  return decoded
}

export async function middleware(request: NextRequest) {
  const pathname = new URL(request.url).pathname
  const path = pathname.replace(/\/+$/, '') || '/'

  if (/^\/(?:articles|all-articles|research|language-science|page\/1)$/.test(path) || path.startsWith('/topics/')) {
    return redirect(request, '/')
  }

  if (path === '/monthly-reports') return redirect(request, '/reports/')
  if (path.startsWith('/reports/')) {
    const report = path.slice('/reports/'.length)
    const normalized = report.toLowerCase()
    const edition = knownMonths.get(normalized)
    if (edition) return redirect(request, `/reports/${edition}/`)
    if (report === 'monthly' || /^monthly\/\d{4}\/\d{1,2}$/.test(report)) {
      return redirect(request, '/reports/')
    }
    if (report !== normalized && knownReports.has(normalized)) return redirect(request, `/reports/${normalized}/`)
  }

  let legacy: string[] | null
  try {
    legacy = legacyArticlePath(path)
  } catch {
    return NextResponse.next()
  }
  if (legacy) {
    const slug = legacy.at(-1)?.toLowerCase()
    if (slug && knownReports.has(slug)) return redirect(request, annualReportPath(slug))
    try {
      const article = await resolvePublicArticle(legacy)
      if (article) {
        const response = redirect(request, articleHref(article))
        response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600')
        return response
      }
      return NextResponse.next()
    } catch (error) {
      console.error('[legacy-article-redirect]', error)
      return new NextResponse('Temporarily unable to look up this article.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
      })
    }
  }

  const parts = path.split('/').filter(Boolean)
  const isFeedPage = parts.length === 2 && parts[0] === 'page'
  if (isFeedPage && !/^[1-9]\d*$/.test(parts[1])) return NextResponse.next()
  const isContentPath = isFeedPage || (parts.length <= 2 && !!contentTypeFromPath(parts[0]))
  const canonical = isContentPath ? `${path}/` : path
  if (canonical !== pathname) return redirect(request, canonical, 308, true)

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next/|.*\\.(?:xml|ico|png|jpg|webp|avif|svg|txt|css|js)$).*)'],
}
