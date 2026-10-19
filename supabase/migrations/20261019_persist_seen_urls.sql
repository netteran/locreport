-- Preserve ingestion history when drafts/articles are subsequently deleted.
-- The primary key on seen_urls.url makes remembering the same URL idempotent.
CREATE OR REPLACE FUNCTION public.remember_source_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_url IS NOT NULL THEN
    INSERT INTO public.seen_urls (url) VALUES (NEW.source_url)
    ON CONFLICT (url) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drafts_remember_source_url ON public.drafts;
CREATE TRIGGER drafts_remember_source_url
AFTER INSERT OR UPDATE OF source_url ON public.drafts
FOR EACH ROW EXECUTE FUNCTION public.remember_source_url();

DROP TRIGGER IF EXISTS articles_remember_source_url ON public.articles;
CREATE TRIGGER articles_remember_source_url
AFTER INSERT OR UPDATE OF source_url ON public.articles
FOR EACH ROW EXECUTE FUNCTION public.remember_source_url();

INSERT INTO public.seen_urls (url)
SELECT source_url FROM public.drafts WHERE source_url IS NOT NULL
UNION
SELECT source_url FROM public.articles WHERE source_url IS NOT NULL
ON CONFLICT (url) DO NOTHING;
