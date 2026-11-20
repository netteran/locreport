const LOGO_NAMES = [
  'TechCrunch','Slator','DeepL','TransPerfect','Crowdin','Phrase','Smartling',
  'Lokalise','NIMDZI','GALA','ELIA','XTM','LanguageLine','Vistatec','PR Newswire',
  'OpenAI','ChatGPT','Google Gemini','Anthropic','Claude','Meta AI','Llama',
  'Hugging Face','Mistral AI',
]

export function HomeLogoTicker() {
  return (
    <div className="home-logo-ticker" aria-hidden="true">
      <div className="home-logo-ticker__track">
        {[0, 1].map(copy => (
          <div key={copy} className="home-logo-ticker__group">
            {LOGO_NAMES.map(name => <span key={name}>{name}</span>)}
          </div>
        ))}
      </div>
    </div>
  )
}
