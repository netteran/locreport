/**
 * Unwrap a Supabase read whose result the page cannot sensibly render without.
 *
 * The pattern this replaces — `const { data } = await supabase...` followed by
 * `data ?? []` — turns a failed query into an empty page served at HTTP 200.
 * That is indistinguishable from "there is genuinely nothing here", both to a
 * reader and to any monitoring, which is how a Supabase wobble showed up as
 * articles quietly vanishing rather than as an error anyone could see.
 *
 * It matters more now that these pages are cached: a blank render no longer
 * lasts one request, it gets stored and served until the next revalidation.
 * Throwing instead leaves the last good version in place — and if it happens
 * during a build, the deploy fails and the previous one keeps serving.
 *
 * Use it for a page's primary content. Genuinely optional extras (a sidebar,
 * a decorative rail) should keep degrading quietly.
 */
export function required<T>(
  result: { data: T; error: { message: string } | null },
  what: string
): T {
  if (result.error) {
    throw new Error(`${what} query failed: ${result.error.message}`)
  }
  return result.data
}
