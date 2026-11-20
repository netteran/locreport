'use client'
import { useState } from 'react'

interface Props {
  domain: string
  name: string
  logoUrl?: string
  website: string
}

export function DirectoryLogo({ domain, name, logoUrl, website }: Props) {
  const initial = name.charAt(0).toUpperCase()
  const [src, setSrc] = useState<string | null>(logoUrl || `https://logo.clearbit.com/${domain}`)
  const [failed, setFailed] = useState(false)

  const inner = (failed || !src)
    ? <div className="dir-entry-logo-fallback">{initial}</div>
    : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name} logo`}
        className="dir-entry-logo"
        onError={() => {
          if (logoUrl && src === logoUrl) {
            setSrc(`https://logo.clearbit.com/${domain}`)
          } else {
            setFailed(true)
          }
        }}
      />
    )

  return (
    <a href={website} target="_blank" rel="noopener" className="dir-entry-logo-link" aria-label={`Visit ${name} website`}>
      {inner}
    </a>
  )
}
