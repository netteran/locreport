'use client'

import { useEffect, useState } from 'react'

const SOURCES = [
  'TechCrunch','Slator','DeepL','TransPerfect','Crowdin','Phrase','Smartling',
  'Lokalise','NIMDZI','GALA','ELIA','XTM','LanguageLine','Vistatec','PR Newswire',
  'OpenAI','ChatGPT','Google Gemini','Anthropic','Claude','Meta AI','Llama',
  'Hugging Face','Mistral AI',
]

export function HomeSources() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(true)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setReduceMotion(preference.matches)
    updatePreference()
    preference.addEventListener('change', updatePreference)
    return () => preference.removeEventListener('change', updatePreference)
  }, [])

  const rotating = !paused && !reduceMotion
  useEffect(() => {
    if (!rotating) return
    const timer = window.setInterval(() => {
      setActive(index => (index + 1) % SOURCES.length)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [rotating])

  function showNext() {
    setActive(index => (index + 1) % SOURCES.length)
    setPaused(true)
  }

  return (
    <section className="home-sources" aria-labelledby="home-sources-title">
      <h2 id="home-sources-title">Sources</h2>
      <div className="home-sources__display" aria-live={rotating ? 'off' : 'polite'}>
        {Array.from({ length: 3 }, (_, offset) => {
          const name = SOURCES[(active + offset) % SOURCES.length]
          return <span key={name} className="home-sources__name">{name}</span>
        })}
      </div>
      <div className="home-sources__actions">
        {!reduceMotion && (
          <button type="button" onClick={() => setPaused(value => !value)}>
            {rotating ? 'Pause' : 'Play'}
          </button>
        )}
        <button type="button" onClick={showNext} aria-label="Show next source">Next</button>
      </div>
    </section>
  )
}
