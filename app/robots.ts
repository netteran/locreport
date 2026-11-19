import { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/api/',
          '/login',
          '/CLAUDE.md',
          '/assets/',
          '/404.html',
          '/cdn-cgi/',
          '/subscribe/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
