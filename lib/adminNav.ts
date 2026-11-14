// Shared by the site header, admin navigation and dashboard overview.
export interface AdminLink {
  href: string
  label: string
  description: string
}

export const ADMIN_GROUPS: { label: string; description: string; links: AdminLink[] }[] = [
  {
    label: 'Editorial',
    description: 'From source evidence to published stories.',
    links: [
      { href: '/admin/candidates', label: 'Source candidates', description: 'Evidence, article suggestions and compositions' },
      { href: '/admin/drafts', label: 'Drafts', description: 'Review, edit and approve pending articles' },
      { href: '/admin/articles', label: 'Articles', description: 'Manage your published archive' },
      { href: '/admin/fact-flow', label: 'Fact Flow', description: 'Review and publish industry news facts' },
    ],
  },
  {
    label: 'Publishing',
    description: 'Create content and manage your editions.',
    links: [
      { href: '/admin/compose', label: 'Compose', description: 'Turn supplied content into an article' },
      { href: '/admin/direct', label: 'Direct entry', description: 'Save a finished article as a draft for review' },
      { href: '/admin/reports', label: 'Reports', description: 'Annual and monthly report images' },
      { href: '/admin/digest-history', label: 'Weekly history', description: 'Inspect previous newsletter sends' },
    ],
  },
  {
    label: 'Configuration',
    description: 'Keep your sources and tools in shape.',
    links: [
      { href: '/admin/sources', label: 'Sources', description: 'RSS, podcasts and collection settings' },
      { href: '/admin/scraped-feeds', label: 'Feed generator', description: 'Create and maintain generated feeds' },
      { href: '/admin/directory', label: 'Directory', description: 'Manage language technology companies' },
      { href: '/admin/prompts', label: 'Prompts', description: 'Tune the article generation instructions' },
    ],
  },
]

export const ADMIN_LINKS: AdminLink[] = [
  { href: '/admin', label: 'Dashboard', description: 'Your editorial workspace at a glance' },
  ...ADMIN_GROUPS.flatMap(group => group.links),
]

export function activeAdminLink(pathname: string): AdminLink {
  return ADMIN_LINKS.find(link => link.href !== '/admin' &&
    (pathname === link.href || pathname.startsWith(`${link.href}/`))) || ADMIN_LINKS[0]
}
