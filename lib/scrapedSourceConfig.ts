import type { ContentFilter } from '@/lib/types'

// The JSON shape edited in the admin textarea — mirrors an entry from
// aparasion/rss-generator's config.json (minus name/type/url/active, which
// get their own form fields). Keeping this vocabulary (rather than the DB's
// snake_case columns) means a config.json entry can be pasted in directly.
export interface ScrapedSourceConfigJson {
  articleSelector?: string
  titleSelector?: string
  linkSelector?: string
  descriptionSelector?: string
  dateSelector?: string
  linkPattern?: string
  feedTitle?: string
  feedDescription?: string
  contentFilter?: ContentFilter
}

export function configJsonToFields(config: ScrapedSourceConfigJson) {
  return {
    article_selector: config.articleSelector || null,
    title_selector: config.titleSelector || null,
    link_selector: config.linkSelector || null,
    description_selector: config.descriptionSelector || null,
    date_selector: config.dateSelector || null,
    link_pattern: config.linkPattern || null,
    feed_title: config.feedTitle || null,
    feed_description: config.feedDescription || null,
    content_filter: config.contentFilter || null,
  }
}

interface SourceFields {
  article_selector: string | null
  title_selector: string | null
  link_selector: string | null
  description_selector: string | null
  date_selector: string | null
  link_pattern: string | null
  feed_title: string | null
  feed_description: string | null
  content_filter: ContentFilter | null
}

export function fieldsToConfigJson(source: SourceFields): ScrapedSourceConfigJson {
  const json: ScrapedSourceConfigJson = {}
  if (source.article_selector) json.articleSelector = source.article_selector
  if (source.title_selector) json.titleSelector = source.title_selector
  if (source.link_selector) json.linkSelector = source.link_selector
  if (source.description_selector) json.descriptionSelector = source.description_selector
  if (source.date_selector) json.dateSelector = source.date_selector
  if (source.link_pattern) json.linkPattern = source.link_pattern
  if (source.feed_title) json.feedTitle = source.feed_title
  if (source.feed_description) json.feedDescription = source.feed_description
  if (source.content_filter) json.contentFilter = source.content_filter
  return json
}
