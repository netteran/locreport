import { isCronRequest } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const BASE_URL = 'https://locreport.com'
const TWEET_LIMIT = 3

// X API v2 — OAuth 1.0a user-context tweet posting
async function postTweet(text: string): Promise<string> {
  const OAuthLib = (await import('oauth-1.0a')).default
  const crypto = await import('crypto')

  const oauth = new OAuthLib({
    consumer: {
      key: process.env.X_API_KEY!,
      secret: process.env.X_API_KEY_SECRET!,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string) {
      return crypto.createHmac('sha1', key).update(base_string).digest('base64')
    },
  })

  const token = {
    key: process.env.X_ACCESS_TOKEN!,
    secret: process.env.X_ACCESS_TOKEN_SECRET!,
  }

  const url = 'https://api.twitter.com/2/tweets'
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'POST' }, token))

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`X API error ${res.status}: ${body}`)
  }

  const data = await res.json()
  return data.data.id as string
}

function buildTweetText(factContent: string, factId: string): string {
  const url = `${BASE_URL}/fact-flow#${factId}`
  // X limit is 280 chars; URL counts as 23 chars (t.co wrapping)
  const maxContent = 280 - 24 - 1 // 24 for URL + space
  const content = factContent.length > maxContent
    ? factContent.slice(0, maxContent - 1) + '…'
    : factContent
  return `${content} ${url}`
}

export async function POST(req: NextRequest) {
  const isCron = isCronRequest(req)

  if (!isCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const required = ['X_API_KEY', 'X_API_KEY_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing env vars: ${missing.join(', ')}` }, { status: 500 })
  }

  const supabase = createServiceClient()

  // Fetch eligible facts: approved (article_id set) and not yet tweeted
  const { data: facts, error } = await supabase
    .from('facts')
    .select('id, content, article_id')
    .eq('status', 'published')
    .is('tweeted_at', null)
    .order('published_at', { ascending: true })
    .limit(TWEET_LIMIT)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!facts || facts.length === 0) {
    return NextResponse.json({ tweeted: 0, message: 'No eligible facts to tweet' })
  }

  const results: { id: string; tweet_id?: string; error?: string }[] = []

  for (const fact of facts) {
    try {
      const tweetText = buildTweetText(fact.content, fact.id)
      const tweetId = await postTweet(tweetText)

      await supabase
        .from('facts')
        .update({ tweeted_at: new Date().toISOString(), tweet_id: tweetId })
        .eq('id', fact.id)

      results.push({ id: fact.id, tweet_id: tweetId })
    } catch (err) {
      results.push({ id: fact.id, error: String(err) })
    }
  }

  const succeeded = results.filter(r => r.tweet_id).length
  const failed = results.filter(r => r.error).length

  return NextResponse.json({ tweeted: succeeded, failed, results })
}
