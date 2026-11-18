import type { SourceCandidate, StoryGroup } from '@/lib/researchTypes'

// A complete normalized pitch can include eight reporting tasks and eight
// source contributions. Keep that reasoning intact when creating or editing it.
export const EDITORIAL_DIRECTION_LIMIT = 40000

export function pitchEditorialDirection(group: StoryGroup, sources: Pick<SourceCandidate, 'id' | 'title'>[]): string {
  const pitch = group.pitch
  if (!pitch) return group.question
  const sections = [`Central question:\n${group.question}`]
  if (pitch.stage === 'investigate' || pitch.missing_evidence.length) {
    sections.push('Evidence status: worth investigating. This is a promising article idea with unresolved reporting, not an established conclusion.')
    if (pitch.missing_evidence.length) sections.push(`Reporting to resolve:\n${pitch.missing_evidence.map(task => `- ${task}`).join('\n')}`)
  }
  if (group.rationale) sections.push(`Why this article:\n${group.rationale}`)
  sections.push(
    `Why now:\n${pitch.why_now}`,
    `Reader and decision:\n${pitch.audience}`,
    `Editorial contribution:\n${pitch.originality}`,
    `Counterargument to test:\n${pitch.counterargument}`,
    `Source contributions (editorial assessments to check against the selected evidence):\n${pitch.source_contributions.map(item => {
      const source = sources.find(source => source.id === item.candidate_id)
      return `- ${source?.title.slice(0, 250) || item.candidate_id}: ${item.contribution}`
    }).join('\n')}`,
    'Drafting approach: use the selected evidence to support factual claims. Add evidence or narrow the scope where reporting is missing. Keep unresolved premises as questions or qualified analysis; do not invent interviews, results or verification to fill a reporting task.'
  )
  return sections.join('\n\n')
}
