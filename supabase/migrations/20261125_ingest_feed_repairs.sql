-- The publisher redirects the old industry-news listing to /blog. Only update
-- the known broken seed; keep editorial overrides, filters, history and XML.
-- The selector-free extractor accepts publisher Article metadata or same-origin
-- links below /blog/, so menu/product pages cannot become feed entries.
update public.scraped_sources
set url = 'https://lingopal.ai/blog',
    article_selector = null,
    title_selector = null,
    link_selector = null,
    description_selector = null,
    date_selector = null,
    link_pattern = '/blog/',
    updated_at = now()
where name = 'LingopalAI'
  and type = 'html'
  and url in ('https://lingopal.ai/industrynews-blog', 'https://lingopal.ai/industrynews-blog/')
  and article_selector = 'a.card-link'
  and link_pattern = '/industrynews-blog/article/';

-- PR Newswire publishes a native RSS feed. Keep the existing localization
-- content filter and keywords; only replace the known blocked HTML listing.
update public.scraped_sources
set type = 'rss',
    url = 'https://www.prnewswire.com/rss/news-releases-list.rss',
    article_selector = null,
    title_selector = null,
    link_selector = null,
    description_selector = null,
    date_selector = null,
    link_pattern = null,
    updated_at = now()
where name = 'PRNewswire-L10N'
  and type = 'html'
  and url in ('https://www.prnewswire.com/news-releases/news-releases-list/', 'https://www.prnewswire.com/news-releases/news-releases-list')
  and article_selector = '.release-list-item';
