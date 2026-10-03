import { createHash } from 'node:crypto'
import {
  providerDriverKindSchema,
  type ProviderAccountUsage,
  type ProviderUsageWindow,
} from '@workspace/contracts'
import { defineErrorCatalog } from 'evlog'
import * as v from 'valibot'
import { usageAccountLabel } from './utils/usage-account-label'
import { codexAccountIdentity, rememberProxyUsageIdentity } from './utils/usage-codex-identity'

const CODEX_DRIVER_KIND = v.parse(providerDriverKindSchema, 'codex')

const proxyUsageErrors = defineErrorCatalog('proxy-usage', {
  CACHE_UNAVAILABLE: {
    status: 502,
    message: 'The proxy usage cache could not be read.',
    why: 'The local management endpoint returned an unreadable cache.',
    fix: 'Check the proxy management URL and secret, then refresh usage.',
  },
})

type JsonObject = Record<string, unknown>
type UsageFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ReadProxyUsageOptions {
  url: string
  secret: string
  fetch?: UsageFetch
  now?: () => number
  identityContext?: string
}

/** Reads passive management caches. Provider probes and queue drains never belong here. */
export async function readProxyUsage(
  options: ReadProxyUsageOptions,
): Promise<ProviderAccountUsage[]> {
  const origin = managementOrigin(options.url, options.secret)
  const now = (options.now ?? Date.now)()
  const fetcher = options.fetch ?? fetch
  const value = await management(origin, options.secret, fetcher)
  const files = object(value)?.files
  const managementObservedAt = timestamp(object(value)?.observed_at, now)
  if (!Array.isArray(files)) throw failure('auth-files-schema')
  const accounts = new Map<string, ProviderAccountUsage>()
  for (const value of files) {
    const file = object(value)
    // Claude logins must never be pooled; even cached Claude rows stay outside this source.
    if (!file || file.provider !== 'codex') continue
    const identity = text(file.id) ?? text(file.auth_index)
    if (!identity) continue
    const accountKey = `proxy:${createHash('sha256')
      .update(JSON.stringify([origin, 'codex', identity]))
      .digest('hex')}`
    if (accounts.has(accountKey)) throw failure('duplicate-account')
    const account = accountSnapshot(file, accountKey, now, managementObservedAt)
    rememberProxyUsageIdentity(
      account,
      codexAccountIdentity(object(file.id_token)?.chatgpt_account_id, options.identityContext),
    )
    accounts.set(accountKey, account)
  }
  return [...accounts.values()]
}

function failure(constraint: string) {
  return proxyUsageErrors.CACHE_UNAVAILABLE({ internal: { constraint } })
}

function managementOrigin(value: string, secret: string) {
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !secret.trim()
    ) {
      throw failure('management-configuration')
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw failure('loopback-management-origin')
    }
    return url.origin
  } catch {
    throw failure('loopback-management-configuration')
  }
}

async function management(origin: string, secret: string, fetcher: UsageFetch): Promise<unknown> {
  try {
    const response = await fetcher(new URL('/v0/management/auth-files', origin), {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw failure('management-http-status')
    return await boundedJson(response)
  } catch {
    // Raw transport errors and management responses may contain credentials.
    throw failure('management-auth-files-read')
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const maximum = 1024 * 1024
  const reader = response.body?.getReader()
  if (!reader) throw failure('empty-management-body')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maximum) throw failure('management-body-size')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function timestamp(value: unknown, now: number): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    return null
  const calendar = value.slice(0, 19)
  const calendarMs = Date.parse(`${calendar}Z`)
  if (!Number.isFinite(calendarMs) || new Date(calendarMs).toISOString().slice(0, 19) !== calendar)
    return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms <= 0 || ms > now || ms > 253402300799999) return null
  return new Date(ms).toISOString()
}

function numeric(value: unknown, maximum = Number.MAX_VALUE): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null
}

function signals(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value) ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key.toLowerCase(), value]),
  )
}

function accountSnapshot(
  file: JsonObject,
  accountKey: string,
  now: number,
  managementObservedAt: string | null,
): ProviderAccountUsage {
  const windows = quotaWindows(file.quota, '', now)
  for (const [model, quota] of Object.entries(object(file.model_quotas) ?? {})) {
    if (!/^gpt-\d[a-z0-9._-]{0,48}$/.test(model)) continue
    windows.push(...quotaWindows(quota, `model:${model}:`, now))
  }
  const quota = object(file.quota)
  const creditsAt = timestamp(quota?.observed_at, now)
  const credits = creditsAt ? cachedCredits(signals(quota?.signals)) : null
  if (credits && (credits.balance > 0 || credits.unlimited)) {
    for (const window of windows) {
      if (window.status === 'rejected') window.status = 'warning'
    }
  }
  const cooldown = observedCooldown(file, managementObservedAt, now)
  const observed = windows.flatMap(({ observedAt }) => (observedAt ? [observedAt] : []))
  if (credits && creditsAt) observed.push(creditsAt)
  const lastSeenAt = observed.sort().at(-1) ?? null
  const cooling = cooldown !== null
  let state: ProviderAccountUsage['state'] = lastSeenAt ? 'ready' : 'no-data'
  if (file.unavailable === true && !cooling) state = 'unknown'
  if (cooling) state = 'cooldown'
  if (file.disabled === true || file.status === 'disabled') state = 'disabled'
  let active: boolean | null = null
  if (file.status === 'active') active = true
  if (file.disabled === true || file.unavailable === true || cooling || file.status === 'disabled')
    active = false
  return {
    accountKey,
    driverKind: CODEX_DRIVER_KIND,
    label: usageAccountLabel(file.email),
    providerInstanceIds: [],
    planType: planLabel(
      signals(quota?.signals)['x-codex-plan-type'] ?? object(file.id_token)?.plan_type,
    ),
    windows,
    checkedAt: lastSeenAt,
    lastSeenAt,
    state,
    stateObservedAt: new Date(now).toISOString(),
    source: 'cli-proxy-management',
    credits,
    ...(cooldown ? { cooldown } : {}),
    routing: { mode: 'rotating', active, lastServedAt: null },
  }
}

function planLabel(value: unknown): string | null {
  const labels: Record<string, string> = {
    free: 'Free',
    go: 'Go',
    plus: 'Plus',
    pro: 'Pro',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    edu: 'Edu',
  }
  if (typeof value !== 'string' || !Object.hasOwn(labels, value.toLowerCase())) return null
  return labels[value.toLowerCase()] ?? null
}

function observedCooldown(
  file: JsonObject,
  managementObservedAt: string | null,
  now: number,
): NonNullable<ProviderAccountUsage['cooldown']> | null {
  const reasons = v.picklist([
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
  ])
  const candidates = Array.isArray(file.cooldowns) ? file.cooldowns : []
  let selected: NonNullable<ProviderAccountUsage['cooldown']> | null = null
  for (const item of candidates) {
    const value = object(item)
    if (value?.scope !== 'credential') continue
    const observedAt =
      timestamp(value.observed_at, now) ?? managementObservedAt ?? new Date(now).toISOString()
    let until = timestamp(value.retry_at, Number.MAX_VALUE)
    const seconds = value.remaining_seconds
    if (
      !until &&
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      seconds <= 31536000
    ) {
      until = new Date(Date.parse(observedAt) + seconds * 1000).toISOString()
    }
    if (until && Date.parse(until) <= now) continue
    if (!until && file.unavailable !== true) continue
    const parsedReason = v.safeParse(reasons, value.reason)
    const candidate = {
      reason: parsedReason.success ? parsedReason.output : ('unknown' as const),
      until,
      observedAt,
      source: 'proxy-state' as const,
    }
    if (!selected || (until ?? '') > (selected.until ?? '')) selected = candidate
  }
  if (selected) return selected
  const until = timestamp(file.next_retry_after, Number.MAX_VALUE)
  if (!until || Date.parse(until) <= now) return null
  return {
    reason: 'unknown',
    until,
    observedAt: new Date(now).toISOString(),
    source: 'proxy-state',
  }
}

function cachedCredits(
  values: Record<string, string>,
): NonNullable<ProviderAccountUsage['credits']> | null {
  const hasCredits = values['x-codex-credits-has-credits']?.toLowerCase()
  const unlimited = values['x-codex-credits-unlimited']?.toLowerCase()
  if (!['true', 'false'].includes(hasCredits ?? '') || !['true', 'false'].includes(unlimited ?? ''))
    return null
  const balance = numeric(values['x-codex-credits-balance'])
  if (balance === null || (hasCredits === 'false' && unlimited === 'false' && balance !== 0))
    return null
  return { balance, unlimited: unlimited === 'true' }
}

function quotaWindows(value: unknown, namespace: string, now: number): ProviderUsageWindow[] {
  const quota = object(value)
  const observedAt = timestamp(quota?.observed_at, now)
  if (!observedAt) return []
  const values = signals(quota?.signals)
  const windows = new Map<string, ProviderUsageWindow>()
  const prefixes = [
    ['x-codex', ''],
    ['x-codex-bengalfox', 'bengalfox:'],
    ['x-codex-additional-gpt-5.3-codex-spark', 'bengalfox:'],
    ['x-codex-code-review', 'code-review:'],
  ] as const
  for (const [prefix, extra] of prefixes) {
    for (const position of ['primary', 'secondary']) {
      const window = cachedWindow(
        values,
        `${prefix}-${position}`,
        `${namespace}${extra}${position}`,
        observedAt,
        now,
      )
      if (!window) continue
      const existing = windows.get(window.id)
      if (existing?.windowMinutes != null && window.windowMinutes === null) continue
      windows.set(window.id, window)
    }
    const idPrefix = `${namespace}${extra}`
    const statusOnly = cachedWindow(values, prefix, `${idPrefix}quota`, observedAt, now)
    if (!statusOnly) continue
    const scoped = [...windows.values()].filter((window) => window.id.startsWith(idPrefix))
    if (scoped.some((window) => window.status === statusOnly.status)) continue
    if (scoped.length && statusOnly.status === 'allowed') continue
    windows.set(statusOnly.id, statusOnly)
  }
  return [...windows.values()]
}

function cachedWindow(
  values: Record<string, string>,
  key: string,
  id: string,
  observedAt: string,
  now: number,
): ProviderUsageWindow | null {
  const usedPercent = numeric(values[`${key}-used-percent`], 100)
  const status = cachedStatus(values, key, usedPercent)
  if (usedPercent === null && status === null) return null
  const duration = numeric(values[`${key}-window-minutes`], 525600)
  if (duration === 0) return null
  const windowMinutes = duration && Number.isInteger(duration) ? duration : null
  let kind: ProviderUsageWindow['kind'] = 'other'
  let label = 'Quota'
  if (windowMinutes !== null) label = `${windowMinutes}m`
  if (windowMinutes === 300) {
    kind = 'session'
    label = '5h'
  }
  if (windowMinutes === 10080) {
    kind = 'weekly'
    label = 'Weekly'
  }
  if (windowMinutes === 43200) {
    kind = 'monthly'
    label = 'Monthly'
  }
  const namespace = id
    .slice(0, id.lastIndexOf(':') + 1)
    .replace('model:', '')
    .replaceAll(':', ' ')
    .trim()
  if (namespace) label = `${namespace} ${label}`
  const resetsAt = cachedReset(values, key, observedAt, windowMinutes)
  let freshness: ProviderUsageWindow['freshness'] = 'unknown'
  if (resetsAt && Date.parse(resetsAt) <= now) freshness = 'reset-passed'
  return {
    id,
    kind,
    label,
    usedPercent,
    resetsAt,
    windowMinutes,
    status,
    observedAt,
    source: 'cliproxy-passive-cache',
    freshness,
  }
}

function cachedStatus(
  values: Record<string, string>,
  key: string,
  usedPercent: number | null,
): ProviderUsageWindow['status'] {
  const allowed = values[`${key}-allowed`]?.trim().toLowerCase()
  const reached = values[`${key}-limit-reached`]?.trim().toLowerCase()
  if (usedPercent === 100 || reached === 'true' || allowed === 'false') return 'rejected'
  if (allowed === 'warning' || allowed === 'allowed_warning') return 'warning'
  if (usedPercent !== null || allowed === 'true') return 'allowed'
  return null
}

function cachedReset(
  values: Record<string, string>,
  key: string,
  observedAt: string,
  minutes: number | null,
): string | null {
  const seconds = numeric(values[`${key}-reset-at`], 253402300799)
  if (seconds !== null && seconds > 0) return new Date(seconds * 1000).toISOString()
  const absolute = timestamp(values[`${key}-reset-at`], Number.MAX_VALUE)
  if (absolute) return absolute
  const relative = numeric(values[`${key}-reset-after-seconds`], 31536000)
  if (relative === null || (relative === 0 && minutes === null)) return null
  const ms = Date.parse(observedAt) + relative * 1000
  return ms <= 253402300799999 ? new Date(ms).toISOString() : null
}
