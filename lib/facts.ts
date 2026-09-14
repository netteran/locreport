export type FactCategory = 'entity' | 'datapoint' | 'milestone' | 'quote'

export interface ParsedFact {
  content: string
  category: FactCategory
}

export interface Fact {
  id: string
  content: string
  category: FactCategory
  source_url: string | null
  source_name: string | null
  draft_id: string | null
  article_id: string | null
  created_at: string
}

const SECTION_MAP: { pattern: RegExp; category: FactCategory }[] = [
  { pattern: /HARD ENTITIES|ENTITIES/i, category: 'entity' },
  { pattern: /DATAPOINTS|STATS/i, category: 'datapoint' },
  { pattern: /CHRONOLOGICAL|MILESTONES/i, category: 'milestone' },
  { pattern: /QUOTES|CLAIMS/i, category: 'quote' },
]

export function parseFacts(raw: string): ParsedFact[] {
  const facts: ParsedFact[] = []
  let currentCategory: FactCategory = 'entity'

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()

    const sectionMatch = SECTION_MAP.find(s => s.pattern.test(trimmed))
    if (sectionMatch) {
      currentCategory = sectionMatch.category
      continue
    }

    if (trimmed.startsWith('- ')) {
      const content = trimmed.slice(2).trim()
      if (content.length > 10) {
        facts.push({ content, category: currentCategory })
      }
    }
  }

  return facts
}

export const CATEGORY_LABELS: Record<FactCategory, string> = {
  entity: 'Entity',
  datapoint: 'Data',
  milestone: 'Milestone',
  quote: 'Quote',
}

/**
 * Pull the single headline fact out of a Fact Flow distillation.
 *
 * Fact Flow publishes exactly one fact per article — the most important one —
 * so this takes the first item the model offers and ignores any extras.
 *
 * It is deliberately forgiving about shape. The numbered-list parser it
 * replaces matched that one shape only, so any drift in the model's output — a
 * bullet, a bare sentence, a bolded lead-in — silently yielded zero facts and
 * the article was published with nothing on Fact Flow at all. Falling back
 * through bullets to a plain first line turns a formatting wobble into a fact
 * rather than a silent gap.
 *
 * Returns null only when the model explicitly declined (NO_FACT) or there is
 * genuinely no usable line — the caller decides what to do about that.
 */
export function parseHeadlineFact(raw: string): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  if (/^NO_FACT\b/i.test(text)) return null

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Markers are stripped in a loop because they nest: "- **Fact:** ..." is one
  // line wearing two of them. Bold is handled before the bullet rule, and the
  // bullet rule demands a following space, so that "**Fact:**" is never
  // mistaken for a "*" bullet and shaved down to "*Fact:**".
  const strip = (line: string) => {
    let out = line.trim()
    for (let pass = 0; pass < 3; pass++) {
      const before = out
      out = out
        .replace(/^\d+[.)]\s*/, '')              // "1. " / "1) "
        .replace(/^\*\*[^*]+?:\*\*\s*/, '')      // "**Fact:** " — a label, drop it
        .replace(/^\*\*[^*]+?\*\*:\s*/, '')       // "**Fact**: " — same, drop it
        .replace(/^\*\*([^*]+?)\*\*/, '$1')       // "**DeepL** extended…" — a subject, keep it
        .replace(/^[-*•]\s+/, '')                // "- " / "* " / "• "
        .trim()
      if (out === before) break
    }
    return out.replace(/^["“](.*)["”]$/, '$1').replace(/\s{2,}/g, ' ').trim()
  }

  const candidates = [
    lines.find(l => /^\d+[.)]\s/.test(l)),   // numbered list — the documented shape
    lines.find(l => /^[-*•]\s/.test(l)),     // bullet list
    lines.find(l => !/^(NO_FACT|OUTPUT|FACT)\b/i.test(l)), // plain prose
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const content = strip(candidate)
    if (content.length > 10) return content
  }

  return null
}
