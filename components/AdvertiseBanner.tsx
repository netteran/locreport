import Link from 'next/link'

/**
 * House banner for the homepage's prime ad slot (under the opening, above
 * "More stories"), offering the space to sponsors. Plain markup, no ad script:
 * it renders into the cached homepage at no runtime cost. Replace it with the
 * sponsor's creative once one is booked.
 */
export function AdvertiseBanner() {
  return (
    <aside className="advertise-banner" aria-label="Advertise on LocReport">
      <p className="advertise-banner__label">Advertise</p>
      <div className="advertise-banner__copy">
        <strong>Your brand here</strong>
        <span>Reach localization and language-technology decision-makers on LocReport.</span>
      </div>
      <Link className="advertise-banner__cta" href="/contact?subject=Advertising%20on%20LocReport">
        Advertise with us
      </Link>
    </aside>
  )
}
