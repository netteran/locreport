import type { NextConfig } from 'next'
import { MONTHLY_REPORT_EDITIONS } from './lib/monthlyReportSlugs'

const nextConfig: NextConfig = {
  async redirects() {
    const datePath = '/:year(\\d{4})/:month(\\d{2})/:day(\\d{2})'
    const monthlyReportRedirects = MONTHLY_REPORT_EDITIONS.flatMap(({ month, year, number, oldSlug, slug }) => {
      const sources = [
        `/articles/${oldSlug}`,
        `/language-science/${oldSlug}`,
        `/reports/Monthly-Report-${month}-${year}`,
        `/reports/monthly/${year}/${number}`,
        `/articles${datePath}/${oldSlug}`,
        `/articles${datePath}/${oldSlug}.html`,
        `/translation${datePath}/${oldSlug}`,
        `/translation${datePath}/${oldSlug}.html`,
        `${datePath}/${oldSlug}`,
      ]
      return sources.map(source => ({ source, destination: `/articles/${slug}`, permanent: true }))
    })

    return [
      ...monthlyReportRedirects,
      { source: '/articles/may-2026-localization-and-translation-industry-report-mq014946', destination: '/articles/may-2026-localization-industry-report', permanent: true },
      { source: '/language-science/:slug', destination: '/articles/:slug', permanent: true },
      { source: '/articles/:year/:month/:day/:slug.html', destination: '/articles/:slug', permanent: true },
      { source: '/articles/:year/:month/:day/:slug', destination: '/articles/:slug', permanent: true },
      { source: '/translation/:year/:month/:day/:slug.html', destination: '/articles/:slug', permanent: true },
      { source: '/translation/:year/:month/:day/:slug', destination: '/articles/:slug', permanent: true },
      { source: `${datePath}/:slug`, destination: '/articles/:slug', permanent: true },
      { source: '/compass', destination: '/#tools', permanent: true },
      { source: '/compass/locstock', destination: '/locstock', permanent: true },
      { source: '/compass/directory/:path*', destination: '/directory/:path*', permanent: true },
      { source: '/compass/llm-pricing', destination: '/llm-pricing', permanent: true },
      { source: '/market', destination: '/locstock', permanent: true },
      { source: '/tools', destination: '/#tools', permanent: true },
      { source: '/tools/directory/:path*', destination: '/directory/:path*', permanent: true },
      { source: '/tools/llm-pricing', destination: '/llm-pricing', permanent: true },
      { source: '/events/:path*', destination: '/#tools', permanent: true },
      { source: '/compass/events/:path*', destination: '/#tools', permanent: true },
      { source: '/reports/monthly', destination: '/reports', permanent: true },
      { source: '/reports/monthly/:year/:month', destination: '/reports', permanent: true },
      { source: '/monthly-reports', destination: '/reports', permanent: true },
    ]
  },
  pageExtensions: ['ts', 'tsx'],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    // Cross-document/page View Transitions; disable this flag if the
    // experimental API misbehaves after a Next.js upgrade.
    viewTransition: true,
  },
}

export default nextConfig
