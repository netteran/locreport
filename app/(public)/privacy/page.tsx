import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'LocReport privacy policy — how we collect, use, and protect your data on locreport.com.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <article className="page-prose">
        <h1>Privacy Policy</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}><strong>Effective Date:</strong> June 8, 2026</p>

        <p>LocReport ("we," "us," or "our") operates the website locreport.com. This Privacy Policy explains how we collect, use, and protect your information.</p>

        <h2>Information We Collect</h2>

        <p><strong>Information you provide directly:</strong></p>
        <ul>
          <li><strong>Contact form:</strong> name, email address, subject, and message content</li>
        </ul>

        <p><strong>Information collected automatically:</strong></p>
        <ul>
          <li><strong>Analytics:</strong> We use Google Analytics to collect anonymized usage data such as pages visited, referral sources, browser type, and approximate geographic location. Google Analytics may set cookies on your device.</li>
          <li><strong>Market data:</strong> When you view market quotes or financial data, requests are made to a third-party financial data provider (Twelve Data). No personal data is transmitted in these requests.</li>
          <li><strong>Local storage:</strong> We store your theme preference (light/dark mode) in your browser's local storage. This data stays on your device and is not transmitted to us.</li>
        </ul>

        <h2>How We Use Your Information</h2>
        <ul>
          <li>To respond to inquiries submitted through our contact form</li>
          <li>To analyze site traffic and improve our content and user experience</li>
          <li>Contact form submissions are stored in our database and a notification email is sent to our team via Resend</li>
          <li>We do not sell, rent, or share your personal information with third parties for marketing purposes</li>
        </ul>

        <h2>Third-Party Services</h2>

        <p>We rely on the following third-party services, each with their own privacy policies:</p>
        <ul>
          <li><strong>Vercel</strong> (website hosting and deployment)</li>
          <li><strong>Supabase</strong> (database and authentication)</li>
          <li><strong>Resend</strong> (transactional email delivery for contact form submissions)</li>
          <li><strong>OpenAI, Anthropic Claude, Google Gemini</strong> (content and editorial support services)</li>
          <li><strong>Twelve Data</strong> (financial market data)</li>
          <li><strong>Google Analytics</strong> (traffic analysis)</li>
          <li><strong>Google AdSense</strong> (advertising)</li>
          <li><strong>Google Fonts</strong> (typeface delivery)</li>
          <li><strong>Buy Me a Coffee</strong> (voluntary support)</li>
        </ul>

        <p>We encourage you to review the privacy policies of these services.</p>

        <h2>Cookies</h2>

        <p>Google Analytics and certain third-party services may place cookies on your device to track usage patterns. You can disable cookies through your browser settings. Doing so will not affect core site functionality.</p>

        <h2>Advertising</h2>

        <p>LocReport uses Google AdSense to help fund the service. As a result of serving ads, Google and other advertising providers may place or read cookies in your browser and use web beacons, IP addresses, or other identifiers to collect information. These providers may collect, use, and share this information to deliver and measure ads and, where permitted by your choices, personalize them.</p>
        <p>See <a href="https://policies.google.com/technologies/partner-sites">how Google uses data from sites that use its services</a>. You can manage ad personalization in <a href="https://myadcenter.google.com/">Google My Ad Center</a>.</p>

        <h2>Data Retention</h2>

        <p>Contact form submissions stored in our database are retained only as long as necessary to respond to your inquiry. Analytics data is retained in accordance with Google Analytics default settings. We do not store any financial market data you view on the site.</p>

        <h2>Your Rights</h2>

        <p>You may request access to, correction of, or deletion of any personal information we hold about you by contacting us through the Contact page. We will respond within a reasonable timeframe.</p>

        <h2>Changes to This Policy</h2>

        <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated effective date.</p>

        <h2>Contact</h2>

        <p>Questions about this policy? Use the <a href="/contact">Contact page</a> to reach us.</p>
      </article>
    </div>
  )
}
