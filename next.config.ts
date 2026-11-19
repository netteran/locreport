import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async redirects() {
    return [
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
