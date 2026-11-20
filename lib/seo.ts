// Site-wide SEO constants and JSON-LD builders.
//
// The Organization / WebSite graph is emitted once from the root layout, so any
// page can reference those nodes by @id instead of redeclaring them — search
// engines merge same-@id nodes across script blocks on the same page.

export const SITE_URL = 'https://locreport.com'

export const ORG_ID = `${SITE_URL}/#organization`
export const WEBSITE_ID = `${SITE_URL}/#website`
export const LOGO_ID = `${SITE_URL}/#logo`

export const ADSENSE_CLIENT = 'ca-pub-4411470587763033'

export const SITE_NAME = 'LocReport'

export const SITE_DESCRIPTION =
  'Independent analysis of localization, language services and AI, with sourced news in Fact Flow, monthly reports, a company directory and LocStock market tracking.'

// Profiles that represent the same entity. Google uses these to resolve the
// brand name to a single organization, so keep them in sync with the footer.
export const SAME_AS = [
  'https://x.com/locreport',
  'https://www.linkedin.com/company/locreport',
]

export const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: SITE_NAME,
      // Catches the spaced parse ("loc report") and the domain-as-name query.
      alternateName: ['Loc Report', 'LocReport.com'],
      url: `${SITE_URL}/`,
      logo: {
        '@type': 'ImageObject',
        '@id': LOGO_ID,
        url: `${SITE_URL}/logolight.png`,
        contentUrl: `${SITE_URL}/logolight.png`,
        width: 862,
        height: 247,
        caption: SITE_NAME,
      },
      image: { '@id': LOGO_ID },
      description: SITE_DESCRIPTION,
      sameAs: SAME_AS,
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      alternateName: 'Loc Report',
      description: SITE_DESCRIPTION,
      publisher: { '@id': ORG_ID },
      inLanguage: 'en',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

export type BreadcrumbItem = { name: string; url?: string }

/** Last item should omit `url` — it is the page the user is already on. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  }
}
