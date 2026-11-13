/** Browser orchestration keeps collection, each matching batch and suggestions
 * in separate requests, each with its own function time budget. */
export interface ResearchRunResult {
  processed: number
  processingComplete: boolean
  suggestionsRefreshed: boolean
  errors: string[]
}

export async function postResearchJson(url: string, body: unknown = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    throw new Error(data?.error || (response.status === 504
      ? 'Request timed out. Saved sources can be continued from Source candidates.'
      : `HTTP ${response.status}`))
  }
  return data
}

export function researchRunSummary(result: ResearchRunResult) {
  const facts = result.processingComplete
    ? `Fact Flow processing ${result.errors.length ? 'finished with issues' : 'complete'}`
    : 'Fact Flow processing incomplete'
  return `${facts}; article suggestions ${result.suggestionsRefreshed ? 'refreshed' : 'not refreshed'}.`
}

export async function runResearchPipeline({
  sourceIds = [],
  onProgress = () => {}
}: {
  sourceIds?: string[]
  onProgress?: (message: string) => void
} = {}): Promise<ResearchRunResult> {
  const result: ResearchRunResult = {
    processed: 0,
    processingComplete: false,
    suggestionsRefreshed: false,
    errors: []
  }
  try {
    // Bound a manual session while making a remaining backlog explicit and
    // resumable. Even a collection with zero new sources must process saved work.
    for (let batch = 0; batch < 20; batch++) {
      onProgress(`Matching events and updating Fact Flow (batch ${batch + 1})…`)
      const data = await postResearchJson('/api/research/process',
        sourceIds.length ? { source_ids: sourceIds } : {})
      if (!['idle', 'processed'].includes(data.action) || !Array.isArray(data.errors)) {
        throw new Error('Unexpected response from event processing')
      }
      result.processed += data.processed ?? 0
      result.errors.push(...data.errors)
      if (data.action === 'idle') {
        result.processingComplete = true
        break
      }
      if (data.processed === 0 && data.errors.length === 0) {
        result.errors.push('Another run is processing events. Use Process facts and suggestions to continue when it finishes.')
        break
      }
    }
    if (!result.processingComplete && result.errors.length === 0) {
      result.errors.push('More sources remain. Use Process facts and suggestions to continue without collecting them again.')
    }
  } catch (error) {
    result.errors.push(`Fact Flow processing: ${error instanceof Error ? error.message : String(error)}`)
    return result
  }
  try {
    onProgress('Refreshing article suggestions…')
    await postResearchJson('/api/research/process', { stage: 'groups' })
    result.suggestionsRefreshed = true
  } catch (error) {
    result.errors.push(`Article suggestions: ${error instanceof Error ? error.message : String(error)}`)
  }
  return result
}
