import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async redirects() {
    return [
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
    ]
  },
  // Middleware standardizes slashes on taxonomy paths without changing existing APIs.
  skipTrailingSlashRedirect: true,
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
