import { CONTENT_TAXONOMY, type ContentType } from '@/lib/contentTaxonomy'
import { loadContentFeed } from '@/lib/contentFeed'
import { ContentFeed } from './ContentFeed'

export async function ContentArchive({ contentType }: { contentType: ContentType }) {
  const taxonomy = CONTENT_TAXONOMY[contentType]
  const initial = await loadContentFeed(1, contentType)
  return (
    <main className="editorial-home">
      <div className="editorial-home__inner">
        <header className="public-page-heading">
          <h1>{taxonomy.section}</h1>
          <p>{taxonomy.description}</p>
        </header>
        <ContentFeed initial={initial} archiveType={contentType} />
      </div>
    </main>
  )
}
