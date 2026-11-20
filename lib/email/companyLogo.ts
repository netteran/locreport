// The public converter reads only directory logos in LocReport's own bucket.
const LOGO_BUCKET_PATH = '/storage/v1/object/public/directory-logos/'
const EMAIL_LOGO_PATH = '/newsletter-assets/company/'
const CONVERTIBLE_FILE = /^[a-z0-9][a-z0-9_.-]{0,199}\.(svg|webp|avif)$/i

function addVersion(url: URL, version: string | null) {
  if (version && /^\d{1,20}$/.test(version)) url.searchParams.set('v', version)
  return url
}

export function emailCompanyLogo(raw: string | null | undefined, siteUrl: string): string | null {
  const value = raw?.trim()
  if (!value || !/^(https:\/\/|\/(?!\/))/i.test(value)) return null

  try {
    const url = new URL(value, siteUrl)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (value.startsWith('/') && url.origin !== new URL(siteUrl).origin) return null
    if (/\.(png|jpe?g|gif)$/i.test(url.pathname)) return url.href

    const file = url.pathname.slice(LOGO_BUCKET_PATH.length)
    const storageUrl = companyLogoStorageUrl(file, null)
    if (storageUrl?.origin !== url.origin || storageUrl.pathname !== url.pathname) return null

    return addVersion(new URL(`${EMAIL_LOGO_PATH}${file}.png`, siteUrl), url.searchParams.get('v')).href
  } catch {
    return null
  }
}

export function companyLogoStorageUrl(file: string, version: string | null): URL | null {
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!storage || !CONVERTIBLE_FILE.test(file)) return null
  return addVersion(new URL(LOGO_BUCKET_PATH + file, storage), version)
}
