-- The production Acclaro source follows press releases. Match the reported
-- legacy configuration and retain its URL, filters, history and saved XML.
update public.scraped_sources
set article_selector = '.resource-card:has(.card-body a[href^="/press/"])',
    title_selector = '.card-body h4',
    link_selector = '.card-body a[href^="/press/"]',
    description_selector = null,
    date_selector = null,
    link_pattern = '/press/',
    updated_at = now()
where name = 'Acclaro'
  and type = 'html'
  and rtrim(url, '/') = 'https://www.acclaro.com/press'
  and article_selector = '.w-dyn-item';

-- Production still reports the legacy Cohere selector. Repair it even if
-- an older setup used different link settings and skipped the earlier update.
update public.scraped_sources
set url = 'https://cohere.com/blog',
    article_selector = 'a[href^="/blog/"]:not([href^="/blog/tag/"]):has(> p.text-balance)',
    title_selector = '> p:first-child',
    link_selector = 'self',
    description_selector = '> p:nth-child(2)',
    date_selector = '> span > p:first-child',
    link_pattern = '/blog/',
    updated_at = now()
where name = 'Cohere-Newsroom-L10N'
  and type = 'html'
  and rtrim(url, '/') = 'https://cohere.com/newsroom/articles'
  and article_selector = 'div[class*=''grid-cols-5'']';
