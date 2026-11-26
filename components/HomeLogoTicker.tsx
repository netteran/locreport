const LOGO_NAMES = [
  'TechCrunch','Slator','DeepL','TransPerfect','Crowdin','Phrase','Smartling',
  'Lokalise','NIMDZI','GALA','ELIA','XTM','LanguageLine','Vistatec','PR Newswire',
  'OpenAI','ChatGPT','Google Gemini','Anthropic','Claude','Meta AI','Llama',
  'Hugging Face','Mistral AI',
]

/** A static label beside a slow, endlessly scrolling line of sources (two copies make the loop seamless). */
export function HomeLogoTicker() {
  return (
    <div className="home-logo-ticker" aria-hidden="true">
      <span className="home-logo-ticker__label">Sources we follow</span>
      <div className="home-logo-ticker__viewport">
        <div className="home-logo-ticker__track">
          {[0, 1].map(copy => (
            <div key={copy} className="home-logo-ticker__group">
              {LOGO_NAMES.map(name => <span key={name}>{name}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
