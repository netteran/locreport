-- Cohere retired /newsroom/articles. Its blog lists company and product
-- announcements with summaries, including language and translation coverage.
update public.scraped_sources
set url = 'https://cohere.com/blog',
    article_selector = 'a[href^="/blog/"]:not([href^="/blog/tag/"]):has(> p.text-balance)',
    title_selector = '> p:first-child',
    link_selector = 'self',
    description_selector = '> p:nth-child(2)',
    date_selector = '> span > p:first-child',
    updated_at = now()
where name = 'Cohere-Newsroom-L10N'
  and type = 'html'
  and url in ('https://cohere.com/newsroom/articles', 'https://cohere.com/newsroom/articles/')
  and article_selector = 'div[class*=''grid-cols-5'']'
  and link_selector = 'a[href^=''/blog/'']'
  and link_pattern = '/blog/';

-- Acclaro's blog now links to Webflow resource pages. Match only known
-- Acclaro blog URLs and the retired RSS endpoints, keeping the existing name.
update public.scraped_sources
set type = 'html',
    url = 'https://www.acclaro.com/blog',
    article_selector = '.resource-card:has(.details-blog-title):has(a[href^="/resources/"])',
    title_selector = '.details-blog-title',
    link_selector = '.blog-card-details a[href^="/resources/"]',
    description_selector = null,
    date_selector = null,
    link_pattern = '/resources/',
    updated_at = now()
where lower(name) like '%acclaro%'
  and (
    (type = 'html' and rtrim(url, '/') in ('https://www.acclaro.com/blog', 'https://acclaro.com/blog')
      and article_selector is distinct from '.resource-card:has(.details-blog-title):has(a[href^="/resources/"])')
    or (type = 'rss' and rtrim(url, '/') in (
      'https://www.acclaro.com/blog/feed', 'https://acclaro.com/blog/feed',
      'https://www.acclaro.com/feed', 'https://acclaro.com/feed'
    ))
  );
