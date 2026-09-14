import { Nav } from '@/components/Nav'
import { BackToTop } from '@/components/BackToTop'
import { DigestPopup } from '@/components/DigestPopup'
import { DigestPopupTrigger } from '@/components/DigestPopupTrigger'
import Link from 'next/link'
import Image from 'next/image'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear()
  return (
    <>
      <Nav />
      {children}
      <BackToTop />
      <DigestPopup />
      <footer className="site-footer">
        <div className="footer-shell">
          <div className="footer-top">
            <div className="footer-brand-col">
              <Link href="/" className="footer-logo" aria-label="LocReport home">
                <Image src="/icon.png" alt="LocReport" width={32} height={32} />
              </Link>
              <p className="footer-tagline">The pulse of the language services industry.</p>
              <DigestPopupTrigger className="footer-digest-link">
                Join The Weekly →
              </DigestPopupTrigger>
              <a href="https://x.com/locreport" className="footer-x-link" target="_blank" rel="noopener" aria-label="LocReport on X">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
                </svg>
              </a>
              <a href="https://www.linkedin.com/company/locreport" className="footer-x-link" target="_blank" rel="noopener" aria-label="LocReport on LinkedIn" style={{ marginLeft: '0.75rem' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
            </div>
            <div className="footer-nav-col">
              <h4 className="footer-nav-title">Coverage</h4>
              <ul className="footer-links" aria-label="Footer coverage links">
                <li><Link href="/articles">All articles</Link></li>
                <li><Link href="/fact-flow">Fact Flow</Link></li>
                <li><Link href="/intelligence">Intelligence</Link></li>
                <li><Link href="/intelligence/signals">Signals tracker</Link></li>
                <li><Link href="/reports/monthly">Monthly reports</Link></li>
              </ul>
            </div>
            <div className="footer-nav-col">
              <h4 className="footer-nav-title">Compass</h4>
              <ul className="footer-links" aria-label="Footer tools links">
                <li><Link href="/compass/locstock">LocStock</Link></li>
                <li><Link href="/compass/events">Industry events</Link></li>
                <li><Link href="/compass/llm-pricing">AI cost simulator</Link></li>
                <li><Link href="/compass/directory">Tech directory</Link></li>
              </ul>
            </div>
            <div className="footer-nav-col">
              <h4 className="footer-nav-title">Company</h4>
              <ul className="footer-links" aria-label="Footer information links">
                <li><Link href="/about">About</Link></li>
                <li><Link href="/contact">Contact</Link></li>
                <li><Link href="/privacy">Privacy</Link></li>
                <li><Link href="/terms">Terms</Link></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p className="footer-copyright">&copy; {year} LocReport. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </>
  )
}
