// Published URL aliases from the previous edge configuration.
export const LEGACY_ARTICLE_SLUGS: Readonly<Record<string, string>> = {
  'enterprise-cms-localization-governance-workflow-and-risk-control-at-scale-mq554wuk': 'enterprise-cms-localization-governance-workflow-and-risk-control-at-scale',
  'should-you-build-or-buy-your-localization-infrastructure-mq552v16': 'should-you-build-or-buy-your-localization-infrastructure',
  'what-happens-when-ai-translates-for-an-audience-not-just-a-language-mq5502ba': 'what-happens-when-ai-translates-for-an-audience-not-just-a-language',
  'forcing-the-fit-mqm-in-the-age-of-automated-evaluation-mq1exsjs': 'forcing-the-fit-mqm-in-the-age-of-automated-evaluation',
  'designing-ai-enabled-localization-workflows-for-enterprise-operations-mq1afbro': 'designing-ai-enabled-localization-workflows-for-enterprise-operations',
  'every-market-is-a-new-market-mq1abdr4': 'every-market-is-a-new-market',
  'international-search-summit-new-york-mq12u088': 'international-search-summit-new-york',
  'humanx-2026-what-vistatec-took-away-from-ais-most-talked-ab': 'humanx-2026--what-vistatec-took-away-from-ais-most-talked-ab',
  'smartling-achieves-iso-27001-certification-strengthening-sec': 'smartling-achieves-iso-27001-certification-strengthening-sec-1',
  'measuring-translation-quality-when-you-dont-speak-the-langua': 'measuring-translation-quality-when-you-dont-speak-the-langua-1',
  'industry-lingopal-wins-2026-nab-show-product-of-the-year-awa': 'lingopal-wins-2026-nab-show-product-of-the-year-award',
  'the-future-of-language-intelligence-a-conversation-with-xtm': 'the-future-of-language-intelligence-a-conversation-with-xtm-1',
  'the-2026-slator-': 'the-2026-slator-index',
  'broadcasting-ai-dubbing-for-broadcasters-what-teams-need-now': 'ai-dubbing-for-broadcasters-what-teams-need-now',
  'mastering-social-media-moves': 'mastering-social-media-moves-1',
  'how-to-turn-technical-documentation-into-multilingual-videos': 'how-to-turn-technical-documentation-into-multilingual-videos-1',
  'finalmente-facebook-makes-it-easier-to-post-status-updates-i': 'finalmente-facebook-makes-it-easier-to-post-status-updates-i-1',
  'may-2026-localization-and-translation-industry-report-mq014946': 'may-2026-localization-industry-report',
}

export function canonicalLegacyArticleSlug(slug: string): string {
  return Object.hasOwn(LEGACY_ARTICLE_SLUGS, slug) ? LEGACY_ARTICLE_SLUGS[slug] : slug
}
