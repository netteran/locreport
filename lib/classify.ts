import { OpenAI } from 'openai'
import { SIGNALS } from './signals'

const SIGNAL_LIST = SIGNALS.map(s => `- ${s.id}: ${s.title}`).join('\n')

const VALID_SEGMENTS = ['Enterprise Buyers', 'LSPs', 'Freelancers', 'LangTech Vendors', 'Researchers']

const CLASSIFIER_SYSTEM_PROMPT = `You are a strict editorial classifier for LocReport, a localization industry intelligence platform. You must resist the urge to over-tag. Default to fewer signals, lower impact scores, and fewer segments — only escalate when the evidence is unambiguous.

Given an article, output a JSON object with exactly these five fields:

{
  "impact_score": <integer 1–5>,
  "time_horizon": <"now" | "6months" | "long-term">,
  "signal_ids": <array of 0–2 signal IDs from the list below>,
  "business_implications": <array of 2–3 strings, each under 15 words, stating the practical significance>,
  "affected_segments": <array of 0–2 values from: "Enterprise Buyers", "LSPs", "Freelancers", "LangTech Vendors", "Researchers">
}

IMPACT SCORE GUIDE — be conservative. Most articles are 1 or 2. Scores of 4–5 should be rare (under 10% of articles combined):
1 = Routine: Minor update, product announcement, or niche practitioner interest
2 = Notable: Meaningful development that informed practitioners should know about
3 = Significant: A clear, documented shift in practice, market position, or technology — not a prediction
4 = Major: A concrete, industry-wide event or decision with immediate structural consequences — not hype
5 = Disruptive: An irreversible paradigm shift with documented, broad impact already underway — almost never appropriate

When in doubt between two scores, choose the lower one.

TIME HORIZON GUIDE:
"now" = Immediate relevance — decisions or actions affected today
"6months" = Medium-term — signals a trend maturing in 3–9 months
"long-term" = Structural shift playing out over 1–3 years

SIGNAL ASSIGNMENT RULES — be selective:
- Only assign a signal if the article is primarily and substantially about that theme
- Do not assign a signal because the article mentions a related concept in passing
- Assign 0 signals if no signal fits the article's core subject well
- Assign at most 1 signal in most cases; use 2 only when two signals are both central to the article

BUSINESS IMPLICATIONS: Write 2–3 concise bullet points explaining why this matters. Each under 15 words. Be specific and grounded in the article — not generic observations.

AFFECTED SEGMENTS: Only include a segment if the article has direct, meaningful relevance to that group — not just tangential connection. Assign at most 2.

AVAILABLE SIGNALS (pick 0–2 that are primary to this article):
${SIGNAL_LIST}

Output ONLY valid JSON. No explanation, no markdown fences.`

export async function classifyArticle(openai: OpenAI, content: string): Promise<{
  impact_score: number | null
  time_horizon: string | null
  signal_ids: string[]
  business_implications: string[]
  affected_segments: string[]
}> {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: content.slice(0, 24000) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    })
    const raw = res.choices[0].message.content ?? '{}'
    const parsed = JSON.parse(raw)
    const validSignalIds = new Set(SIGNALS.map(s => s.id))
    return {
      impact_score: typeof parsed.impact_score === 'number'
        ? Math.max(1, Math.min(5, Math.round(parsed.impact_score)))
        : null,
      time_horizon: ['now', '6months', 'long-term'].includes(parsed.time_horizon)
        ? parsed.time_horizon
        : null,
      signal_ids: Array.isArray(parsed.signal_ids)
        ? parsed.signal_ids.filter((id: unknown) => typeof id === 'string' && validSignalIds.has(id))
        : [],
      business_implications: Array.isArray(parsed.business_implications)
        ? parsed.business_implications.filter((s: unknown) => typeof s === 'string').slice(0, 4)
        : [],
      affected_segments: Array.isArray(parsed.affected_segments)
        ? parsed.affected_segments.filter((s: unknown) => typeof s === 'string' && VALID_SEGMENTS.includes(s))
        : [],
    }
  } catch {
    return { impact_score: null, time_horizon: null, signal_ids: [], business_implications: [], affected_segments: [] }
  }
}
