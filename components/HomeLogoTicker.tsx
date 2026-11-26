const LOGO_NAMES = [
  'TechCrunch','Slator','DeepL','TransPerfect','Crowdin','Phrase','Smartling',
  'Lokalise','NIMDZI','GALA','ELIA','XTM','LanguageLine','Vistatec','PR Newswire',
  'OpenAI','ChatGPT','Google Gemini','Anthropic','Claude','Meta AI','Llama',
  'Hugging Face','Mistral AI',
]

/** A static line of sources we follow; it used to scroll, which was the busiest thing on the page. */
export function HomeLogoTicker() {
  return (
    <div className="home-logo-ticker" aria-hidden="true">
      <div className="home-logo-ticker__track">
        <span className="home-logo-ticker__label">Sources we follow</span>
        <div className="home-logo-ticker__group">
          {LOGO_NAMES.map(name => <span key={name}>{name}</span>)}
        </div>
      </div>
    </div>
  )
}
