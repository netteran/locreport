'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

const CLIENT = 'ca-pub-4411470587763033'

type Format = 'desktop' | 'mobile'

function AdUnit({ format, desktopSlot, mobileSlot }: { format: Format; desktopSlot: string; mobileSlot: string }) {
  const element = useRef<HTMLModElement>(null)
  const requested = useRef(false)
  const desktop = format === 'desktop'

  useEffect(() => {
    if (!element.current || requested.current) return
    requested.current = true
    const adWindow = window as Window & { adsbygoogle?: object[] }
    try {
      ;(adWindow.adsbygoogle = adWindow.adsbygoogle || []).push({})
    } catch (error) {
      console.error('Unable to initialize ad', error)
    }
  }, [])

  return (
    <ins
      ref={element}
      className="adsbygoogle"
      style={{ display: 'inline-block', width: desktop ? 728 : 320, height: desktop ? 90 : 100 }}
      data-ad-client={CLIENT}
      data-ad-slot={desktop ? desktopSlot : mobileSlot}
    />
  )
}

type DisplayAdProps = {
  placement: string
  desktopSlot: string
  mobileSlot: string
}

export function DisplayAd({ placement, desktopSlot, mobileSlot }: DisplayAdProps) {
  const container = useRef<HTMLDivElement>(null)
  const [format, setFormat] = useState<Format | null>(null)
  const [adsBlocked, setAdsBlocked] = useState(false)

  useEffect(() => {
    // Cosmetic filters can hide ads even when the provider script loads.
    // Keep the probe outside the ad container so the notice remains visible.
    const probe = document.createElement('div')
    probe.className = 'adsbox ad-banner ad-unit'
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;pointer-events:none;'
    document.body.appendChild(probe)
    const check = () => {
      if (!navigator.onLine) return
      const style = window.getComputedStyle(probe)
      if (!probe.isConnected || style.display === 'none' || style.visibility === 'hidden'
        || probe.getBoundingClientRect().height === 0) {
        setAdsBlocked(true)
      }
    }
    const timers = [window.setTimeout(check, 750), window.setTimeout(check, 2500)]
    return () => {
      timers.forEach(window.clearTimeout)
      probe.remove()
    }
  }, [])

  useEffect(() => {
    if (!container.current) return
    // Measure the feed itself: the desktop sidebar reduces available width.
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      setFormat(width >= 728 ? 'desktop' : width >= 320 ? 'mobile' : null)
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={container} className="home-ad-reservation" data-ad-placement={placement}>
      <Script
        id="google-adsense"
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onError={() => {
          // A failed request suggests blocking, but can also be a network error.
          if (navigator.onLine) setAdsBlocked(true)
        }}
      />
      <div className="home-ad-reservation__slot">
        {adsBlocked ? (
          <div className="service-support-notice" role="status">
            <span className="service-support-notice__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
              </svg>
            </span>
            <div className="service-support-notice__copy">
              <strong className="service-support-notice__title">A little support keeps LocReport going.</strong>
              <span className="service-support-notice__text">Ads help fund the service and its upkeep. Please allow ads on this site, then reload.</span>
            </div>
            <button className="service-support-notice__button" type="button" onClick={() => window.location.reload()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 7v5h-5" />
                <path d="M20 12a8 8 0 1 0-2.3 5.7M20 7l-2.3-2.3" />
              </svg>
              Reload page
            </button>
          </div>
        ) : format ? (
          <AdUnit key={format} format={format} desktopSlot={desktopSlot} mobileSlot={mobileSlot} />
        ) : null}
      </div>
    </div>
  )
}

export function HomeFeedAd() {
  return <DisplayAd placement="home-feed" desktopSlot="5585148873" mobileSlot="6111888795" />
}
