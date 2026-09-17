// Single source of truth for the admin section's links — used by the
// "Admin" dropdown in the main site header (components/Nav.tsx).
export interface AdminLink {
  href: string
  label: string
}

export const ADMIN_LINKS: AdminLink[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/drafts', label: 'Drafts' },
  { href: '/admin/articles', label: 'Articles' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/scraped-feeds', label: 'Feed Generator' },
  { href: '/admin/fact-flow', label: 'Fact Flow' },
  { href: '/admin/digest-history', label: 'Weekly History' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/directory', label: 'Directory' },
  { href: '/admin/compose', label: 'Compose' },
  { href: '/admin/direct', label: 'Direct' },
  { href: '/admin/prompts', label: 'Prompts' },
]
