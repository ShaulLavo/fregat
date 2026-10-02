import * as v from 'valibot'

export const maxFeedBytes = 64 * 1024
const safeName = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9._-]{0,63}$/))
const providerSchema = v.picklist(['claude', 'codex'])
export const usageAccountsSchema = v.pipe(
  v.array(
    v.strictObject({ id: safeName, provider: providerSchema, label: safeName, plan: safeName }),
  ),
  v.minLength(1),
  v.maxLength(16),
  v.check((accounts) => new Set(accounts.map(({ id }) => id)).size === accounts.length),
  v.check(
    (accounts) =>
      new Set(accounts.map(({ provider, label }) => `${provider}:${label}`)).size ===
      accounts.length,
  ),
  v.check((accounts) => accounts.filter(({ provider }) => provider === 'claude').length === 1),
)
export type UsageAccountConfig = v.InferOutput<typeof usageAccountsSchema>[number]
export const configuredAccounts: UsageAccountConfig[] = [
  { id: 'claude-shaul9191', provider: 'claude', label: 'shaul9191', plan: 'max' },
  { id: 'codex-shaul9191', provider: 'codex', label: 'shaul9191', plan: 'pro' },
  { id: 'codex-shaul.lavochkin', provider: 'codex', label: 'shaul.lavochkin', plan: 'pro' },
]

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}
const timeSchema = v.pipe(
  v.string(),
  v.check((value) => timestamp(value) !== null),
)
const sourceSchema = v.picklist(['proxy-state', 'passive-header'])
const percentSchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100))
const minutesSchema = v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(525600))
const windowSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/)),
  label: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9][a-zA-Z0-9 .:_-]{0,95}$/)),
  usedPercent: v.nullable(percentSchema),
  resetsAt: v.nullable(
    v.pipe(
      timeSchema,
      v.check((value) => Date.parse(value) > 0),
    ),
  ),
  windowMinutes: v.nullable(minutesSchema),
  status: v.picklist(['allowed', 'warning', 'exhausted', 'unknown']),
  lastSeenAt: v.nullable(timeSchema),
  source: sourceSchema,
})
const cooldownReasons = v.picklist([
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
const cooldownSchema = v.strictObject({
  reason: cooldownReasons,
  until: v.nullable(timeSchema),
  observedAt: timeSchema,
  source: sourceSchema,
})
const accountSchema = v.strictObject({
  id: safeName,
  provider: providerSchema,
  label: safeName,
  plan: safeName,
  checkedAt: v.nullable(timeSchema),
  lastSeenAt: v.nullable(timeSchema),
  state: v.picklist(['ready', 'cooldown', 'disabled', 'no-data', 'unknown']),
  source: sourceSchema,
  routing: v.strictObject({
    mode: v.picklist(['single', 'rotating', 'unknown']),
    active: v.nullable(v.boolean()),
    lastServedAt: v.nullable(timeSchema),
  }),
  windows: v.pipe(v.array(windowSchema), v.maxLength(64)),
  cooldown: v.nullable(cooldownSchema),
})
const snapshotSchema = v.strictObject({
  schemaVersion: v.literal(1),
  generatedAt: timeSchema,
  accounts: v.pipe(v.array(accountSchema), v.maxLength(16)),
})
export type UsageSnapshot = v.InferOutput<typeof snapshotSchema>
type Account = UsageSnapshot['accounts'][number]
type Window = Account['windows'][number]
type Signals = Readonly<Record<string, string>>
const quotaSchema = v.object({
  observed_at: v.optional(v.string()),
  signals: v.optional(v.record(v.string(), v.string())),
})
const proxyFileSchema = v.object({
  provider: v.string(),
  email: v.optional(v.string()),
  label: v.optional(v.string()),
  status: v.optional(v.string()),
  disabled: v.optional(v.boolean()),
  unavailable: v.optional(v.boolean()),
  quota: v.optional(quotaSchema),
  model_quotas: v.optional(v.record(v.string(), quotaSchema)),
  cooldowns: v.optional(
    v.nullable(
      v.array(
        v.object({
          scope: v.string(),
          reason: v.string(),
          retry_at: v.optional(v.string()),
          remaining_seconds: v.optional(v.number()),
        }),
      ),
    ),
  ),
})
const proxySchema = v.object({ observed_at: timeSchema, files: v.array(proxyFileSchema) })
type ProxyFile = v.InferOutput<typeof proxyFileSchema>

export function createUsageSnapshot(
  accounts: readonly UsageAccountConfig[],
  now: string,
): UsageSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: now,
    accounts: accounts.map((config) => ({
      id: config.id,
      provider: config.provider,
      label: config.label,
      plan: config.plan,
      checkedAt: null,
      lastSeenAt: null,
      state: 'no-data',
      source: config.provider === 'claude' ? 'passive-header' : 'proxy-state',
      routing: {
        mode: config.provider === 'claude' ? 'single' : 'rotating',
        active: null,
        lastServedAt: null,
      },
      windows: [],
      cooldown: null,
    })),
  }
}

function bounded(snapshot: UsageSnapshot) {
  return (
    Buffer.byteLength(JSON.stringify(snapshot)) <= maxFeedBytes &&
    v.safeParse(snapshotSchema, snapshot).success
  )
}

export function restoreUsageSnapshot(
  value: unknown,
  accounts: readonly UsageAccountConfig[],
): UsageSnapshot | null {
  const parsed = v.safeParse(snapshotSchema, value)
  if (
    !parsed.success ||
    !bounded(parsed.output) ||
    parsed.output.accounts.length !== accounts.length
  )
    return null
  const matches = accounts.every((config, index) => {
    const account = parsed.output.accounts[index]!
    return (
      account.id === config.id &&
      account.provider === config.provider &&
      account.label === config.label &&
      account.plan === config.plan
    )
  })
  return matches ? parsed.output : null
}

function number(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null
  const result = Number(value)
  return Number.isFinite(result) && result >= min && result <= max ? result : null
}
function reset(value: string | undefined) {
  if (value === undefined || value.trim() === '') return null
  const seconds = number(value, 0, 253402300799)
  if (seconds !== null) return new Date(seconds * 1000).toISOString()
  return timestamp(value)
}
function relativeReset(value: string | undefined, observedAt: string) {
  const seconds = number(value, 0, 31536000)
  return seconds === null ? null : new Date(Date.parse(observedAt) + seconds * 1000).toISOString()
}
function severity(percent: number | null, status?: string): Window['status'] {
  if (status === 'rejected' || status === 'exhausted' || percent === 100) return 'exhausted'
  if (status === 'allowed_warning' || status === 'warning' || (percent !== null && percent >= 75))
    return 'warning'
  if (status === 'allowed' || percent !== null) return 'allowed'
  return 'unknown'
}
function lowerSignals(signals: Signals) {
  return Object.fromEntries(
    Object.entries(signals).map(([name, value]) => [name.toLowerCase(), value]),
  )
}
function slot(minutes: number | null, position: string) {
  if (minutes === 300) return { id: 'five_hour', label: '5h' }
  if (minutes === 10080) return { id: 'weekly', label: 'Weekly' }
  return { id: position, label: minutes === null ? 'Quota' : `${minutes}m` }
}
function codexReset(signals: Signals, key: string, observedAt: string, minutes: number | null) {
  const absolute = reset(signals[`${key}-reset-at`])
  if (absolute && Date.parse(absolute) > 0) return absolute
  const seconds = number(signals[`${key}-reset-after-seconds`], 0, 31536000)
  // A zero relative reset cannot establish a deadline for an unidentified window.
  if (seconds === null || (seconds === 0 && minutes === null)) return null
  return relativeReset(String(seconds), observedAt)
}
function codexWindow(
  signals: Signals,
  prefix: string,
  position: string,
  observedAt: string,
): Window | null {
  const key = `${prefix}-${position}`
  const usedPercent = number(signals[`${key}-used-percent`], 0, 100)
  const windowMinutes = number(signals[`${key}-window-minutes`], 1, 525600)
  const resetsAt = codexReset(signals, key, observedAt, windowMinutes)
  const statusValue = signals[`${key}-limit-reached`] === 'true' ? 'exhausted' : undefined
  if (usedPercent === null && resetsAt === null && statusValue === undefined) return null
  return {
    ...slot(windowMinutes, position),
    usedPercent,
    resetsAt,
    windowMinutes,
    status: severity(usedPercent, statusValue),
    lastSeenAt: observedAt,
    source: 'proxy-state',
  }
}
type CodexObservation = { window: Window; slotId: string }
function codexWindows(
  quota: v.InferOutput<typeof quotaSchema> | undefined,
  namespace = '',
): CodexObservation[] {
  const observedAt = timestamp(quota?.observed_at)
  if (!observedAt || !quota?.signals) return []
  const signals = lowerSignals(quota.signals)
  const windows: CodexObservation[] = []
  // HTTP and websocket use different names for the same Spark allowance.
  const prefixes = [
    ['x-codex', ''],
    ['x-codex-bengalfox', 'bengalfox:'],
    ['x-codex-additional-gpt-5.3-codex-spark', 'bengalfox:'],
    ['x-codex-code-review', 'code-review:'],
  ] as const
  for (const [prefix, extra] of prefixes) {
    for (const position of ['primary', 'secondary']) {
      const window = codexWindow(signals, prefix, position, observedAt)
      if (!window) continue
      windows.push({
        slotId: `${namespace}${extra}${position}`,
        window: {
          ...window,
          id: `${namespace}${extra}${window.id}`,
          label:
            `${namespace.replaceAll(':', ' ')}${extra.replaceAll(':', ' ')}${window.label}`.trim(),
        },
      })
    }
  }
  return windows
}
function mergeWindows(previous: readonly Window[], incoming: readonly Window[]) {
  const windows = new Map(previous.map((window) => [window.id, window]))
  for (const window of incoming) {
    const old = windows.get(window.id)
    if (
      old?.lastSeenAt &&
      (!window.lastSeenAt || Date.parse(old.lastSeenAt) > Date.parse(window.lastSeenAt))
    )
      continue
    windows.set(window.id, window)
  }
  const rank = (id: string) => ['five_hour', 'weekly', 'primary', 'secondary'].indexOf(id)
  return [...windows.values()].sort((a, b) => {
    const first = rank(a.id),
      second = rank(b.id)
    if (first >= 0 || second >= 0) return (first < 0 ? 4 : first) - (second < 0 ? 4 : second)
    return a.id.localeCompare(b.id)
  })
}
function mergeCodexWindows(previous: readonly Window[], incoming: readonly CodexObservation[]) {
  const windows = new Map(previous.map((window) => [window.id, window]))
  const accepted: Window[] = []
  for (const { window, slotId } of incoming) {
    const alias = windows.get(slotId)
    if (
      alias?.lastSeenAt &&
      (!window.lastSeenAt || Date.parse(alias.lastSeenAt) > Date.parse(window.lastSeenAt))
    )
      continue
    if (window.id !== slotId) windows.delete(slotId)
    accepted.push(window)
  }
  return mergeWindows([...windows.values()], accepted)
}
function latestObservation(windows: readonly Window[]) {
  const observed = windows.flatMap(({ lastSeenAt }) => (lastSeenAt ? [lastSeenAt] : []))
  return observed.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}
function matchesAccount(file: ProxyFile, account: Account, approved: ReadonlySet<string>) {
  if (file.provider.toLowerCase() !== 'codex') return false
  const labels = [file.email, file.label].flatMap((value) =>
    value ? [value.trim().split('@')[0]!.toLowerCase()] : [],
  )
  const identities = new Set(labels.filter((label) => approved.has(label)))
  return identities.size === 1 && identities.has(account.label)
}
function cooldown(
  file: ProxyFile,
  observedAt: string,
  previous: Account['cooldown'],
): Account['cooldown'] {
  if (file.cooldowns == null) return previous
  const active = file.cooldowns
    .filter((item) => item.scope === 'credential')
    .map((item) => ({
      reason: v.safeParse(cooldownReasons, item.reason).success
        ? (item.reason as v.InferOutput<typeof cooldownReasons>)
        : ('unknown' as const),
      until:
        timestamp(item.retry_at) ?? relativeReset(item.remaining_seconds?.toString(), observedAt),
      observedAt,
      source: 'proxy-state' as const,
    }))
    .filter((item) => item.until && Date.parse(item.until) > Date.parse(observedAt))
  return active.sort((a, b) => Date.parse(b.until!) - Date.parse(a.until!))[0] ?? null
}
function proxyAccount(
  account: Account,
  file: ProxyFile,
  observedAt: string,
  checkedAt: string,
): Account {
  const incoming = codexWindows(file.quota)
  for (const [model, quota] of Object.entries(file.model_quotas ?? {})) {
    if (!/^gpt-\d[a-z0-9._-]{0,48}$/.test(model)) continue
    incoming.push(...codexWindows(quota, `model:${model}:`))
  }
  const windows = mergeCodexWindows(account.windows, incoming)
  const restriction = cooldown(file, observedAt, account.cooldown)
  const active = file.disabled || file.unavailable ? false : null
  const available = active === null && file.status === 'active' ? true : active
  let state: Account['state'] = windows.length ? 'ready' : 'no-data'
  if (file.unavailable && !restriction) state = 'unknown'
  if (restriction) state = 'cooldown'
  if (file.disabled) state = 'disabled'
  return {
    ...account,
    checkedAt,
    lastSeenAt: latestObservation(windows),
    windows,
    cooldown: restriction,
    state,
    routing: { mode: 'rotating', active: available, lastServedAt: null },
  }
}

export function normalizeProxySnapshot(
  value: unknown,
  previous: UsageSnapshot,
  checkedAt: string,
): UsageSnapshot | null {
  const parsed = v.safeParse(proxySchema, value)
  if (!parsed.success) return null
  const observedAt = timestamp(parsed.output.observed_at)!
  const approved = new Set(
    previous.accounts.filter(({ provider }) => provider === 'codex').map(({ label }) => label),
  )
  const accounts = previous.accounts.map((account) => {
    if (account.provider !== 'codex') return account
    const matching = parsed.output.files.filter((file) => matchesAccount(file, account, approved))
    if (matching.length !== 1) return account
    return proxyAccount(account, matching[0]!, observedAt, checkedAt)
  })
  const next: UsageSnapshot = { ...previous, generatedAt: checkedAt, accounts }
  return bounded(next) ? next : null
}

function claudeWindow(headers: Headers, namespace: string, observedAt: string): Window | null {
  const prefix = `anthropic-ratelimit-unified-${namespace}`
  const utilization = number(headers.get(`${prefix}-utilization`) ?? undefined, 0, 1)
  const usedPercent = utilization === null ? null : utilization * 100
  const resetsAt = reset(headers.get(`${prefix}-reset`) ?? undefined)
  const status = severity(usedPercent, headers.get(`${prefix}-status`)?.toLowerCase())
  if (usedPercent === null && resetsAt === null && status === 'unknown') return null
  const weekly = namespace.startsWith('7d')
  const id = weekly ? namespace.replace('7d', 'weekly').replace('-', ':') : 'five_hour'
  const label = weekly ? namespace.replace('7d', 'Weekly').replace('-', ' ') : '5h'
  return {
    id,
    label,
    usedPercent,
    resetsAt,
    status,
    windowMinutes: weekly ? 10080 : 300,
    lastSeenAt: observedAt,
    source: 'passive-header',
  }
}

export function observeClaudeHeaders(
  previous: UsageSnapshot,
  headers: Headers,
  observedAt: string,
): UsageSnapshot {
  const incoming = ['5h', '7d', '7d-sonnet', '7d-opus'].flatMap((namespace) => {
    const window = claudeWindow(headers, namespace, observedAt)
    return window ? [window] : []
  })
  if (!incoming.length) return previous
  const accounts = previous.accounts.map((account) => {
    if (account.provider !== 'claude') return account
    const windows = mergeWindows(account.windows, incoming)
    return {
      ...account,
      checkedAt: observedAt,
      lastSeenAt: latestObservation(windows),
      state: 'ready' as const,
      windows,
    }
  })
  const next = { ...previous, generatedAt: observedAt, accounts }
  return bounded(next) ? next : previous
}
