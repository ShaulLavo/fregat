import * as v from 'valibot'

const feedText = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((text) => text.trim() === text, 'Feed text must be trimmed.'),
  v.check(
    (text) => new TextEncoder().encode(text).length <= 128,
    'Feed text exceeds its byte limit.',
  ),
  v.regex(/^[^\p{Cc}\p{Cf}]+$/u),
)
const feedSource = v.picklist(['passive-header', 'proxy-state'])
const feedTime = v.pipe(
  v.string(),
  v.check((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
    const ms = Date.parse(value)
    return (
      Number.isFinite(ms) &&
      ms > Date.parse('0001-01-01T00:00:00Z') &&
      new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19)
    )
  }, 'Feed timestamps must be valid UTC instants.'),
)
const nullableTime = v.nullable(feedTime)

/** Mesh v1 is strict: detailed native provenance belongs on windows. */
const feedSchema = v.strictObject({
  schemaVersion: v.literal(1),
  generatedAt: feedTime,
  accounts: v.array(
    v.strictObject({
      id: feedText,
      provider: feedText,
      label: feedText,
      plan: feedText,
      checkedAt: nullableTime,
      lastSeenAt: nullableTime,
      state: v.picklist(['ready', 'cooldown', 'disabled', 'no-data', 'unknown']),
      source: feedSource,
      routing: v.strictObject({
        mode: v.picklist(['single', 'rotating', 'unknown']),
        active: v.nullable(v.boolean()),
        lastServedAt: nullableTime,
      }),
      windows: v.array(
        v.strictObject({
          id: feedText,
          label: feedText,
          usedPercent: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100))),
          resetsAt: nullableTime,
          windowMinutes: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE))),
          status: v.picklist(['allowed', 'warning', 'exhausted', 'unknown']),
          lastSeenAt: nullableTime,
          source: feedText,
        }),
      ),
      cooldown: v.nullable(
        v.strictObject({
          reason: v.picklist([
            'unknown',
            'credential_quota',
            'quota',
            'cloudflare_challenge',
            'model_not_supported',
            'invalid_grant',
            'unauthorized',
            'payment_required',
            'not_found',
            'transient_error',
          ]),
          until: nullableTime,
          observedAt: feedTime,
          source: feedSource,
        }),
      ),
      credits: v.optional(
        v.nullable(
          v.strictObject({
            balance: v.pipe(v.number(), v.finite(), v.minValue(0)),
            unlimited: v.boolean(),
          }),
        ),
      ),
    }),
  ),
})

export const providerUsageFeedSchema = v.pipe(
  feedSchema,
  v.check((feed) => {
    const generated = Date.parse(feed.generatedAt)
    const ids = new Set<string>()
    for (const account of feed.accounts) {
      if (ids.has(account.id)) return false
      ids.add(account.id)
      const times = [
        account.checkedAt,
        account.lastSeenAt,
        account.routing.lastServedAt,
        account.cooldown?.observedAt,
      ]
      if (times.some((time) => time && Date.parse(time) > generated)) return false
      const windowIds = new Set<string>()
      for (const window of account.windows) {
        if (windowIds.has(window.id) || (window.usedPercent !== null && !window.lastSeenAt))
          return false
        if (window.lastSeenAt && Date.parse(window.lastSeenAt) > generated) return false
        windowIds.add(window.id)
      }
    }
    return new TextEncoder().encode(JSON.stringify(feed)).length <= 64 * 1024
  }, 'Feed observations must be uniquely identified, dated and bounded.'),
)

export type ProviderUsageFeed = v.InferOutput<typeof providerUsageFeedSchema>
