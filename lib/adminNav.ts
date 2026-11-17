export interface AdminLink { href: string; label: string; description: string }
export const ADMIN_LINKS: AdminLink[] = [
  { href: '/admin', label: 'Dashboard', description: 'Feed generation, ingest and market updates' },
  { href: '/admin/candidates', label: 'Articles creation', description: 'Sources, evidence, suggestions, drafts and published articles' },
  { href: '/admin/fact-flow', label: 'Facts creation', description: 'Create, edit and publish Fact Flow items' },
  { href: '/admin/weekly', label: 'Weekly newsletter', description: 'Edit the complete edition, preview and send' },
  { href: '/admin/monthly', label: 'Monthly brief', description: 'Generate, review and publish the monthly briefing' },
  { href: '/admin/directory', label: 'Directory', description: 'Edit and maintain company entries' },
  { href: '/admin/prompts', label: 'Prompts', description: 'Manage editorial instructions' },
]
export const ARTICLE_LINKS: AdminLink[] = [
  { href: '/admin/scraped-feeds', label: 'Feed generation', description: 'Maintain generated feeds' },
  { href: '/admin/sources', label: 'Sources', description: 'External and generated sources' },
  { href: '/admin/candidates', label: 'Candidates & suggestions', description: 'Choose evidence and develop articles' },
  { href: '/admin/drafts', label: 'Draft review', description: 'Review and publish' },
  { href: '/admin/articles', label: 'Published articles', description: 'Manage the archive' },
]
export const OTHER_ARTICLE_LINKS: AdminLink[] = [
  { href: '/admin/compose', label: 'Compose', description: 'Create from supplied material' },
  { href: '/admin/direct', label: 'Direct entry', description: 'Enter a finished article' },
]
export function activeAdminLink(pathname: string): AdminLink {
  if ([...ARTICLE_LINKS, ...OTHER_ARTICLE_LINKS].some(link => pathname === link.href || pathname.startsWith(`${link.href}/`))) return ADMIN_LINKS[1]
  if (pathname.startsWith('/admin/digest-history') || pathname.startsWith('/admin/weekly')) return ADMIN_LINKS[3]
  if (pathname.startsWith('/admin/reports') || pathname.startsWith('/admin/monthly')) return ADMIN_LINKS[4]
  return ADMIN_LINKS.find(link => link.href !== '/admin' && (pathname === link.href || pathname.startsWith(`${link.href}/`))) || ADMIN_LINKS[0]
}
