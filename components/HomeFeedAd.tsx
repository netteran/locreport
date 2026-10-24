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
      />
      <div className="home-ad-reservation__slot">
        {format && <AdUnit key={format} format={format} desktopSlot={desktopSlot} mobileSlot={mobileSlot} />}
      </div>
    </div>
  )
}

export function HomeFeedAd() {
  return <DisplayAd placement="home-feed" desktopSlot="5585148873" mobileSlot="6111888795" />
}
