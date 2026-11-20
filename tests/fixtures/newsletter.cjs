// Representative newsletter copy for rendering and saved-preview checks.
module.exports = {
  storyCount: 3,
  articleIds: [],
  editorNote: 'A week of practical questions about language AI. **Our focus:** the work between a promising pilot and a dependable service.',
  topStory: {
    id: 'story',
    title: 'Language AI moves from pilots to operating decisions',
    url: 'https://locreport.com/articles/newest-authored-analysis',
    excerpt: 'Buyers are looking beyond model benchmarks to the workflows around them. Across recent industry discussions, the recurring questions concern evaluation, governance and the people who handle exceptions.',
    business_implications: ['Test a representative workflow before expanding a deployment.', 'Make quality ownership and the cost of exceptions explicit.'],
  },
  company: {
    name: 'Atlas Language Systems',
    url: 'https://locreport.com/directory/atlas-language-systems',
    logoUrl: 'https://locreport.com/icon.png',
    category: 'Translation management',
    hq: 'Warsaw, Poland',
    founded: 2015,
    blurb: 'Atlas connects language teams with the systems where their content starts. Its tools cover translation workflows, review and delivery across enterprise applications.',
  },
  facts: [
    { content: 'A language services provider introduced a new enterprise review workflow.', url: 'https://publisher.example.test/review' },
    { content: 'A translation platform expanded its terminology controls for regulated content.', url: 'https://publisher.example.test/terminology' },
    { content: 'Industry buyers are asking for clearer evaluation evidence before deployment.', url: 'https://publisher.example.test/evaluation' },
  ],
  market: {
    avgPct: 3.4, tracked: 12,
    movers: [{ symbol: 'ABC', name: 'Example Language Group', pct: 9.2 }, { symbol: 'XYZ', name: 'Global Content Systems', pct: -8.1 }],
    url: 'https://locreport.com/locstock',
  },
  directory: [{ name: 'Context & Review', category: 'Quality tools', description: 'Review tools that help language teams record evidence and resolve exceptions.', url: 'https://locreport.com/directory/context-review' }],
  more: [
    { id: 'more-one', title: 'What buyers need from an evaluation', url: 'https://locreport.com/articles/buyer-workflow-decision' },
    { id: 'more-two', title: 'Where language expertise changes the decision', url: 'https://locreport.com/articles/combined-analysis' },
  ],
  moreCount: 2,
}
