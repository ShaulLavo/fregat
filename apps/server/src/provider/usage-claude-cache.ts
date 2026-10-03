import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as v from 'valibot'
import { claudeUsageProbe, type ProviderUsageProbe } from './utils/usage-windows'

const cacheSchema = v.object({
  oauthAccount: v.object({ accountUuid: v.string(), organizationType: v.optional(v.string()) }),
  cachedUsageUtilization: v.object({
    accountUuid: v.string(),
    fetchedAtMs: v.pipe(v.number(), v.finite(), v.minValue(1)),
    utilization: v.record(v.string(), v.unknown()),
  }),
})

/** Reads only an account-matched CLI snapshot; neither credentials nor identifiers leave here. */
export async function readClaudeUsageCache(
  filePath: string,
  nowMs: number,
): Promise<{
  observedAt: string
  probe: ProviderUsageProbe
} | null> {
  try {
    if ((await stat(filePath)).size > 2 * 1024 * 1024) return null
    const parsed = v.safeParse(cacheSchema, JSON.parse(await readFile(filePath, 'utf8')))
    if (!parsed.success) return null
    const { oauthAccount: account, cachedUsageUtilization: cache } = parsed.output
    if (
      !cache.accountUuid ||
      cache.accountUuid !== account.accountUuid ||
      cache.fetchedAtMs > nowMs
    )
      return null
    const known: NonNullable<SDKControlGetUsageResponse['rate_limits']> = {}
    for (const id of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const) {
      const window = v.safeParse(
        v.object({
          utilization: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100)),
          resets_at: v.nullable(v.string()),
        }),
        cache.utilization[id],
      )
      if (window.success) known[id] = window.output
    }
    const extra = v.safeParse(
      v.object({
        is_enabled: v.boolean(),
        monthly_limit: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
        used_credits: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
        utilization: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100))),
      }),
      cache.utilization.extra_usage,
    )
    if (extra.success) known.extra_usage = extra.output
    const { probe } = claudeUsageProbe({
      rate_limits_available: true,
      rate_limits: known,
      subscription_type: account.organizationType ?? null,
    })
    if (probe.kind !== 'reading' || probe.update.windows.length === 0) return null
    return { observedAt: new Date(cache.fetchedAtMs).toISOString(), probe }
  } catch {
    // Optional CLI state can disappear during its own atomic save.
    return null
  }
}

/** Fingerprints stay in the sanitized cache so a changed login cannot inherit its old windows. */
export async function readClaudeUsageIdentity(
  filePath: string,
): Promise<string | null | undefined> {
  try {
    if ((await stat(filePath)).size > 2 * 1024 * 1024) return undefined
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      oauthAccount?: { accountUuid?: unknown }
    }
    const uuid = parsed.oauthAccount?.accountUuid
    if (typeof uuid !== 'string' || !uuid.trim()) return null
    return createHash('sha256').update(`claude-account\0${uuid}`).digest('hex')
  } catch {
    return undefined
  }
}
