import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as v from 'valibot'
import {
  providerAccountUsageSchema,
  providerDriverKindSchema,
  providerUsageFeedSchema,
  providerUsageWindowSchema,
  type ProviderAccountUsage,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderUsageFeed,
  type ProviderUsageResult,
} from '@workspace/contracts'
import { writeFileAtomicSync } from '../fs/atomic-write'
import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import type { ProviderAdapter, ProviderRuntimeEvent } from './types'
import { readClaudeUsageCache, readClaudeUsageIdentity } from './usage-claude-cache'
import {
  mergeUsageWindows,
  type ProviderUsageProbe,
  type ProviderUsageUpdate,
} from './utils/usage-windows'

type UsageAccounts = Pick<ProviderAdapterRegistry, 'adapter' | 'listInstances' | 'usageAccount'>
type AccountTarget = {
  accountKey: string
  adapter: ProviderAdapter | null
  driverKind: ProviderDriverKind
  providerInstanceIds: ProviderInstanceId[]
  claudeCachePath: string | null
  credentialFingerprint?: string | null
}
type StoredAccount = {
  snapshot: ProviderAccountUsage
  attemptedAt: number | null
  failed: boolean
  unsupported: boolean
  identityFingerprint?: string | null
  credentialFingerprint?: string | null
}
export type UsageRefreshPolicy = {
  minIntervalMs: number
  failureCooldownMs: number
  staleAfterMs: number
}
const DEFAULT_POLICY: UsageRefreshPolicy = {
  minIntervalMs: 300_000,
  failureCooldownMs: 600_000,
  staleAfterMs: 900_000,
}
const cacheSchema = v.object({
  version: v.literal(1),
  accounts: v.array(
    v.object({
      snapshot: providerAccountUsageSchema,
      attemptedAt: v.nullable(v.pipe(v.number(), v.finite())),
      failed: v.boolean(),
      unsupported: v.boolean(),
      identityFingerprint: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)))),
      credentialFingerprint: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)))),
    }),
  ),
  proxyAccounts: v.array(providerAccountUsageSchema),
  proxyAttemptedAt: v.nullable(v.pipe(v.number(), v.finite())),
  proxyFailed: v.boolean(),
  proxySourceKey: v.nullable(v.string()),
})

/** Reads never start collection. A lifecycle-owned schedule persists sanitized observations. */
export class ProviderUsageStore {
  private readonly accounts = new Map<string, StoredAccount>()
  private readonly probes = new Map<string, Promise<boolean>>()
  private readonly suspended = new Map<string, number>()
  private proxyAccounts: ProviderAccountUsage[] = []
  private proxyAttemptedAt: number | null = null
  private proxyFailed = false
  private proxyProbe: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private generation = 0
  private writeRetryAt = 0
  private failedWrites = 0
  private suppressedWrites = 0
  private proxySourceKey: string | null = null
  private readonly now: () => number
  private readonly policy: () => UsageRefreshPolicy
  private readonly registry: UsageAccounts
  private readonly options: {
    now?: () => number
    cacheFile?: string
    policy?: () => UsageRefreshPolicy
    readProxy?: () => Promise<ProviderAccountUsage[]>
    proxyInstanceIds?: () => ProviderInstanceId[]
    proxyConfigured?: () => boolean
    proxySourceKey?: () => string | null
  }

  constructor(
    registry: UsageAccounts,
    options: {
      now?: () => number
      cacheFile?: string
      policy?: () => UsageRefreshPolicy
      readProxy?: () => Promise<ProviderAccountUsage[]>
      proxyInstanceIds?: () => ProviderInstanceId[]
      proxyConfigured?: () => boolean
      proxySourceKey?: () => string | null
    } = {},
  ) {
    this.registry = registry
    this.options = options
    this.now = options.now ?? Date.now
    this.policy = options.policy ?? (() => DEFAULT_POLICY)
    this.proxySourceKey = this.sourceKey()
    this.hydrate()
  }

  start() {
    if (this.timer || this.closed) return
    const generation = ++this.generation
    this.timer = setTimeout(() => {
      void this.tick(generation)
    }, 0)
    this.timer.unref()
  }

  reconfigure() {
    const key = this.sourceKey()
    if (key !== this.proxySourceKey) {
      this.proxySourceKey = key
      this.proxyAccounts = []
      this.proxyAttemptedAt = null
      this.proxyFailed = false
      this.persist()
    }
    if (!this.timer || this.closed) return
    clearTimeout(this.timer)
    this.timer = null
    this.start()
  }

  private sourceKey() {
    const key = this.options.proxySourceKey?.() ?? null
    return key ? createHash('sha256').update(key).digest('hex') : null
  }

  async close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await Promise.allSettled([...this.probes.values(), this.proxyProbe])
    this.persist(true)
  }

  accept(event: ProviderRuntimeEvent) {
    if (event.type !== 'account.rate-limits.updated' || !event.providerInstanceId || this.closed)
      return
    if (!validObservedAt(event.createdAt, this.now())) return
    const account = this.registry.usageAccount(event.providerInstanceId)
    if (!account?.enabled) return
    const target = this.targets().find((entry) => entry.accountKey === account.accountKey)
    if (!target || target.driverKind === 'codex') return
    const fingerprint = this.accounts.get(target.accountKey)?.credentialFingerprint
    if (fingerprint !== undefined && fingerprint !== target.credentialFingerprint) return
    this.applyUpdate(target, event.payload, event.createdAt, 'rate-limit-event')
    this.persist()
  }

  async read(): Promise<ProviderUsageResult> {
    const native = this.targets().map((target) => this.snapshot(target))
    const mappings = this.proxyMappings()
    const configured =
      (this.options.proxyConfigured?.() ?? Boolean(this.options.readProxy)) || mappings.length > 0
    const proxy =
      configured && this.proxyAccounts.length === 0
        ? [
            {
              accountKey: 'local-proxy-source',
              driverKind: v.parse(providerDriverKindSchema, 'codex'),
              providerInstanceIds: mappings,
              planType: null,
              checkedAt: null,
              lastSeenAt: null,
              source: 'cli-proxy-management',
              state: 'no-data' as const,
              windows: [],
              routing: { mode: 'unknown' as const, active: null, lastServedAt: null },
            },
          ]
        : this.proxyAccounts
    return {
      accounts: [
        ...native,
        ...(configured
          ? proxy.map((account) =>
              this.withFreshness({ ...account, providerInstanceIds: mappings }),
            )
          : []),
      ],
    }
  }

  async feed(): Promise<ProviderUsageFeed> {
    const { accounts } = await this.read()
    const feed: ProviderUsageFeed = {
      schemaVersion: 1,
      generatedAt: new Date(this.now()).toISOString(),
      accounts: accounts.map((account, index) => ({
        id: safeFeedText(account.accountKey),
        provider: safeFeedText(account.driverKind),
        label: `${account.driverKind === 'claude' ? 'Claude' : 'Codex'} account ${index + 1}`,
        plan: safeFeedText(account.planType ?? 'Unknown'),
        checkedAt: account.checkedAt,
        lastSeenAt: account.lastSeenAt ?? account.checkedAt,
        state: account.state ?? 'unknown',
        source: account.source === 'rate-limit-event' ? 'passive-header' : 'proxy-state',
        routing: account.routing ?? { mode: 'unknown', active: null, lastServedAt: null },
        windows: account.windows.map((window) => ({
          id: safeFeedText(window.id),
          label: safeFeedText(window.label),
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt,
          windowMinutes: window.windowMinutes,
          status: feedWindowStatus(window),
          lastSeenAt: window.observedAt ?? null,
          source: safeFeedText(window.source ?? account.source ?? 'unknown'),
        })),
        cooldown: account.cooldown ?? null,
        ...(account.credits ? { credits: account.credits } : {}),
      })),
    }
    return v.parse(providerUsageFeedSchema, boundFeed(feed))
  }

  suspendCollection(accountKey: string) {
    this.suspended.set(accountKey, (this.suspended.get(accountKey) ?? 0) + 1)
    return () => {
      const count = (this.suspended.get(accountKey) ?? 1) - 1
      if (count > 0) this.suspended.set(accountKey, count)
      else this.suspended.delete(accountKey)
    }
  }

  /** Explicit mutation refreshes are serialized with the scheduled collector. */
  async refreshAccount(accountKey: string): Promise<boolean> {
    if (this.closed) return false
    const target = this.targets().find((entry) => entry.accountKey === accountKey)
    if (!target) return false
    return this.collect(target, true)
  }

  async refresh() {
    if (this.closed) return
    await Promise.allSettled([
      ...this.targets().map((target) => this.collect(target, false)),
      this.refreshProxy(),
    ])
    this.persist()
  }

  private async tick(generation: number) {
    try {
      await this.refresh()
    } finally {
      if (!this.closed && generation === this.generation) {
        this.timer = setTimeout(() => {
          void this.tick(generation)
        }, this.policy().minIntervalMs)
        this.timer.unref()
      }
    }
  }

  private proxyMappings() {
    return [...new Set(this.options.proxyInstanceIds?.() ?? [])].filter((id) => {
      const account = this.registry.usageAccount(id)
      return account?.enabled && account.driverKind === 'codex'
    })
  }

  private targets() {
    const targets = new Map<string, AccountTarget>()
    const mapped = new Set(this.proxyMappings())
    for (const providerInstanceId of this.registry.listInstances()) {
      if (mapped.has(providerInstanceId)) continue
      const account = this.registry.usageAccount(providerInstanceId)
      if (!account?.enabled) continue
      const target = targets.get(account.accountKey) ?? {
        accountKey: account.accountKey,
        adapter: null,
        driverKind: account.driverKind,
        providerInstanceIds: [],
        claudeCachePath: account.claudeCachePath ?? null,
        credentialFingerprint: account.credentialFingerprint,
      }
      target.providerInstanceIds.push(providerInstanceId)
      target.adapter ??= this.registry.adapter(providerInstanceId)
      targets.set(account.accountKey, target)
    }
    return [...targets.values()]
  }

  private collect(target: AccountTarget, force: boolean): Promise<boolean> {
    if (!force && this.suspended.has(target.accountKey)) return Promise.resolve(false)
    const pending = this.probes.get(target.accountKey)
    if (pending) return pending
    const previous = this.accounts.get(target.accountKey)
    const wait = previous?.failed ? this.policy().failureCooldownMs : this.policy().minIntervalMs
    if (
      !force &&
      previous?.credentialFingerprint === target.credentialFingerprint &&
      previous?.attemptedAt != null &&
      this.now() - previous.attemptedAt < wait
    )
      return Promise.resolve(false)
    const probe = this.probe(target, force).finally(() => this.probes.delete(target.accountKey))
    this.probes.set(target.accountKey, probe)
    return probe
  }

  private async probe(target: AccountTarget, force: boolean) {
    const startedAt = this.now()
    const wasFailed = this.accounts.get(target.accountKey)?.failed ?? false
    this.adoptCredentials(target)
    this.markAttempt(target, wasFailed)
    this.persist()
    const source =
      target.driverKind === 'codex' ? 'codex-account-rate-limits' : 'claude-sdk-control'
    try {
      const identity = target.claudeCachePath
        ? await readClaudeUsageIdentity(target.claudeCachePath)
        : undefined
      this.adoptIdentity(target, identity)
      const cached = target.claudeCachePath
        ? await readClaudeUsageCache(target.claudeCachePath, this.now())
        : null
      if (cached) {
        this.applyProbe(target, cached.probe, cached.observedAt, 'claude-local-cache')
        if (!force && this.now() - Date.parse(cached.observedAt) < this.policy().minIntervalMs) {
          this.markAttempt(target, false)
          this.persist()
          return true
        }
      }
      if (!target.adapter?.readUsage) return false
      const result = await target.adapter.readUsage()
      const current = this.registry.usageAccount(target.providerInstanceIds[0]!)
      if (current && current.credentialFingerprint !== target.credentialFingerprint) {
        this.adoptCredentials({ ...target, credentialFingerprint: current.credentialFingerprint })
        this.persist()
        return false
      }
      if (result.kind === 'reading' && result.identityFingerprint)
        this.adoptIdentity(target, result.identityFingerprint)
      const currentIdentity = target.claudeCachePath
        ? await readClaudeUsageIdentity(target.claudeCachePath)
        : undefined
      this.adoptIdentity(target, currentIdentity)
      if (identity !== undefined && currentIdentity !== undefined && identity !== currentIdentity) {
        this.persist()
        return false
      }
      this.applyProbe(target, result, new Date(startedAt).toISOString(), source)
      this.markAttempt(target, false)
      this.persist()
      recordChatPipelineInfo('chat.pipeline.provider_usage.probe', {
        driverKind: target.driverKind,
        durationMs: this.now() - startedAt,
        outcome: result.kind,
        source,
      })
      return result.kind === 'reading'
    } catch {
      this.markAttempt(target, true)
      this.persist()
      if (!wasFailed)
        recordChatPipelineWarning('chat.pipeline.provider_usage.probe_failed', {
          driverKind: target.driverKind,
          durationMs: this.now() - startedAt,
          source,
        })
      return false
    }
  }

  private adoptCredentials(target: AccountTarget) {
    const previous = this.accounts.get(target.accountKey)
    if (!previous || previous.credentialFingerprint === target.credentialFingerprint) return
    this.accounts.set(target.accountKey, {
      ...previous,
      snapshot: this.empty(target),
      unsupported: false,
      credentialFingerprint: target.credentialFingerprint,
    })
  }

  private adoptIdentity(target: AccountTarget, identity: string | null | undefined) {
    if (identity === undefined) return
    const previous = this.accounts.get(target.accountKey)
    if (!previous || previous.identityFingerprint === identity) return
    this.accounts.set(target.accountKey, {
      ...previous,
      snapshot: this.empty(target),
      unsupported: false,
      identityFingerprint: identity,
    })
  }

  private markAttempt(target: AccountTarget, failed: boolean) {
    const stored = this.accounts.get(target.accountKey) ?? {
      snapshot: this.empty(target),
      attemptedAt: null,
      failed: false,
      unsupported: false,
      credentialFingerprint: target.credentialFingerprint,
    }
    this.accounts.set(target.accountKey, { ...stored, attemptedAt: this.now(), failed })
  }

  private applyProbe(
    target: AccountTarget,
    result: ProviderUsageProbe,
    observedAt: string,
    source: string,
  ) {
    const previous = this.accounts.get(target.accountKey)
    if (result.kind === 'unsupported') {
      // Control capability says nothing about retained cache or passive quota evidence.
      if (previous) previous.unsupported = true
      return
    }
    this.applyUpdate(target, result.update, observedAt, source)
    const stored = this.accounts.get(target.accountKey)!
    if (
      !previous?.snapshot.checkedAt ||
      Date.parse(observedAt) >= Date.parse(previous.snapshot.checkedAt)
    )
      stored.snapshot.resetCredits = result.resetCredits ?? null
    stored.unsupported = false
  }

  private applyUpdate(
    target: AccountTarget,
    update: ProviderUsageUpdate,
    observedAt: string,
    source: string,
  ) {
    const stored = this.accounts.get(target.accountKey) ?? {
      snapshot: this.empty(target),
      attemptedAt: null,
      failed: false,
      unsupported: false,
      credentialFingerprint: target.credentialFingerprint,
    }
    const previous = stored.snapshot
    const updates = update.windows
      .filter((reading) => {
        if (!validWindow(reading, observedAt, this.now())) return false
        const known = previous.windows.find((window) => window.id === reading.id)
        if (!known?.observedAt) return true
        if (
          reading.resetsAt &&
          known.resetsAt &&
          Date.parse(reading.resetsAt) < Date.parse(known.resetsAt)
        )
          return false
        const delta = Date.parse(observedAt) - Date.parse(known.observedAt)
        return (
          delta > 0 ||
          (delta === 0 && (known.source !== 'rate-limit-event' || source === 'rate-limit-event'))
        )
      })
      .map((reading) => {
        const known = previous.windows.find((window) => window.id === reading.id)
        const retainsPercent =
          reading.usedPercent === null &&
          known?.usedPercent != null &&
          (!reading.resetsAt || reading.resetsAt === known.resetsAt)
        return {
          ...reading,
          source: retainsPercent ? known.source : source,
          observedAt: retainsPercent ? known.observedAt : observedAt,
        }
      })
    const newer = !previous.checkedAt || Date.parse(observedAt) >= Date.parse(previous.checkedAt)
    const checkedAt = newer ? observedAt : previous.checkedAt
    this.accounts.set(target.accountKey, {
      ...stored,
      snapshot: {
        ...previous,
        checkedAt,
        lastSeenAt: checkedAt,
        source: newer ? source : previous.source,
        planType: newer ? (update.planType ?? previous.planType) : previous.planType,
        windows: mergeUsageWindows(previous.windows, updates),
        credits:
          newer && update.credits !== undefined ? update.credits : (previous.credits ?? null),
      },
    })
  }

  private empty(target: AccountTarget): ProviderAccountUsage {
    return {
      accountKey: target.accountKey,
      driverKind: target.driverKind,
      providerInstanceIds: target.providerInstanceIds,
      planType: null,
      checkedAt: null,
      lastSeenAt: null,
      state: 'no-data',
      source: 'unknown',
      windows: [],
      resetCredits: null,
      routing: { mode: 'unknown', active: null, lastServedAt: null },
    }
  }

  private snapshot(target: AccountTarget) {
    const known = this.accounts.get(target.accountKey)
    const stored = known?.credentialFingerprint === target.credentialFingerprint ? known : undefined
    return this.withFreshness({
      ...(stored?.snapshot ?? this.empty(target)),
      providerInstanceIds: target.providerInstanceIds,
      resetCredits: target.adapter?.consumeResetCredit ? stored?.snapshot.resetCredits : null,
    })
  }

  private withFreshness(account: ProviderAccountUsage): ProviderAccountUsage {
    const windows = account.windows.map((window) => {
      const observedAt = window.observedAt ?? null
      return {
        ...window,
        observedAt,
        freshness: windowFreshness(
          window.resetsAt,
          observedAt,
          this.now(),
          this.policy().staleAfterMs,
        ),
      }
    })
    return {
      ...account,
      state: accountState(account, windows, this.now(), this.policy().staleAfterMs),
      windows,
    }
  }

  private async refreshProxy() {
    if (!this.options.readProxy || this.options.proxyConfigured?.() === false) return
    if (this.proxyProbe) return this.proxyProbe
    const wait = this.proxyFailed ? this.policy().failureCooldownMs : this.policy().minIntervalMs
    if (this.proxyAttemptedAt !== null && this.now() - this.proxyAttemptedAt < wait) return
    const sourceKey = this.sourceKey()
    this.proxyAttemptedAt = this.now()
    this.persist()
    this.proxyProbe = this.options
      .readProxy()
      .then((accounts) => {
        if (sourceKey !== this.sourceKey()) return
        const valid = accounts.filter((account) => validCachedAccount(account, this.now()))
        this.proxyAccounts = valid.map((account) =>
          retainProxyObservations(
            this.proxyAccounts.find((previous) => previous.accountKey === account.accountKey),
            account,
          ),
        )
        this.proxyFailed = false
      })
      .catch(() => {
        if (sourceKey !== this.sourceKey()) return
        if (!this.proxyFailed)
          recordChatPipelineWarning('chat.pipeline.provider_usage.proxy_failed', {
            outcome: 'cache-retained',
          })
        this.proxyFailed = true
      })
      .finally(() => {
        this.proxyProbe = null
        if (sourceKey !== this.sourceKey()) {
          this.reconfigure()
          return
        }
        this.proxyAttemptedAt = this.now()
      })
    return this.proxyProbe
  }

  private hydrate() {
    if (!this.options.cacheFile) return
    try {
      if (statSync(this.options.cacheFile).size > 1024 * 1024) return
      const cache = v.parse(cacheSchema, JSON.parse(readFileSync(this.options.cacheFile, 'utf8')))
      for (const account of cache.accounts) {
        if (account.attemptedAt !== null && account.attemptedAt > this.now()) continue
        if (validCachedAccount(account.snapshot, this.now()))
          this.accounts.set(account.snapshot.accountKey, account)
      }
      if (cache.proxySourceKey !== this.proxySourceKey) return
      this.proxyAccounts = cache.proxyAccounts.filter((account) =>
        validCachedAccount(account, this.now()),
      )
      this.proxyAttemptedAt =
        cache.proxyAttemptedAt !== null && cache.proxyAttemptedAt <= this.now()
          ? cache.proxyAttemptedAt
          : null
      this.proxyFailed = cache.proxyFailed
    } catch {
      // A missing or invalid cache leaves configured no-data accounts visible.
    }
  }

  private persist(force = false) {
    if (!this.options.cacheFile) return
    if (!force && this.now() < this.writeRetryAt) {
      this.suppressedWrites += 1
      return
    }
    const active = new Set(this.targets().map((target) => target.accountKey))
    const cache = {
      version: 1,
      accounts: [...this.accounts].filter(([key]) => active.has(key)).map(([, value]) => value),
      proxyAccounts: this.proxyAccounts,
      proxyAttemptedAt: this.proxyAttemptedAt,
      proxyFailed: this.proxyFailed,
      proxySourceKey: this.proxySourceKey,
    }
    try {
      mkdirSync(path.dirname(this.options.cacheFile), { recursive: true })
      writeFileAtomicSync(this.options.cacheFile, JSON.stringify(cache), {
        durability: 'fsync-file',
        mode: 0o600,
      })
      if (this.failedWrites)
        recordChatPipelineInfo('chat.pipeline.provider_usage.cache_write_recovered', {
          failedAttempts: this.failedWrites,
          suppressedWrites: this.suppressedWrites,
        })
      this.failedWrites = 0
      this.suppressedWrites = 0
      this.writeRetryAt = 0
    } catch {
      this.failedWrites += 1
      this.writeRetryAt = this.now() + this.policy().failureCooldownMs
      if (this.failedWrites === 1)
        recordChatPipelineWarning('chat.pipeline.provider_usage.cache_write_failed', {
          outcome: 'memory-retained',
          retryAfterMs: this.policy().failureCooldownMs,
        })
    }
  }
}

function windowFreshness(
  resetsAt: string | null,
  observedAt: string | null,
  nowMs: number,
  staleAfterMs: number,
): 'fresh' | 'stale' | 'reset-passed' | 'unknown' {
  if (!observedAt) return 'unknown'
  if (resetsAt && Date.parse(resetsAt) <= nowMs) return 'reset-passed'
  return nowMs - Date.parse(observedAt) >= staleAfterMs ? 'stale' : 'fresh'
}

function safeFeedText(value: string) {
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  let bounded = ''
  for (const char of cleaned) {
    if (Buffer.byteLength(bounded + char) > 128) break
    bounded += char
  }
  return bounded.trim() || 'Unknown'
}

function feedWindowStatus(
  window: ProviderAccountUsage['windows'][number],
): ProviderUsageFeed['accounts'][number]['windows'][number]['status'] {
  if (window.freshness !== 'fresh') return 'unknown'
  if (window.status === 'rejected') return 'exhausted'
  return window.status ?? (window.usedPercent === null ? 'unknown' : 'allowed')
}

function validTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
  const ms = Date.parse(value)
  return (
    Number.isFinite(ms) && ms > 0 && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19)
  )
}

function validObservedAt(value: string | null | undefined, nowMs: number) {
  return Boolean(value && validTimestamp(value) && Date.parse(value) <= nowMs)
}

function validCachedAccount(account: ProviderAccountUsage, nowMs: number) {
  if (!v.safeParse(providerAccountUsageSchema, account).success) return false
  if (new Set(account.windows.map((window) => window.id)).size !== account.windows.length)
    return false
  if (!/^(?:[a-f0-9]{16}|proxy:[a-f0-9]{64}|local-proxy-source)$/.test(account.accountKey))
    return false
  if (account.planType && Buffer.byteLength(account.planType) > 128) return false
  if (account.checkedAt && !validObservedAt(account.checkedAt, nowMs)) return false
  if (account.lastSeenAt && !validObservedAt(account.lastSeenAt, nowMs)) return false
  if (account.stateObservedAt && !validObservedAt(account.stateObservedAt, nowMs)) return false
  if (account.routing?.lastServedAt && !validObservedAt(account.routing.lastServedAt, nowMs))
    return false
  if (
    account.cooldown &&
    (!validObservedAt(account.cooldown.observedAt, nowMs) ||
      (account.cooldown.until && !validTimestamp(account.cooldown.until)))
  )
    return false
  if (account.credits && !Number.isFinite(account.credits.balance)) return false
  return account.windows.every((window) => validWindow(window, window.observedAt ?? null, nowMs))
}

function validWindow(
  window: ProviderAccountUsage['windows'][number],
  observedAt: string | null,
  nowMs: number,
) {
  if (!v.safeParse(providerUsageWindowSchema, window).success) return false
  if (
    [window.id, window.label, window.source ?? 'unknown'].some(
      (value) => Buffer.byteLength(value) > 128 || /[\p{Cc}\p{Cf}]/u.test(value),
    )
  )
    return false
  if (window.resetsAt && !validTimestamp(window.resetsAt)) return false
  return observedAt === null ? window.usedPercent === null : validObservedAt(observedAt, nowMs)
}

function retainProxyObservations(
  previous: ProviderAccountUsage | undefined,
  account: ProviderAccountUsage,
): ProviderAccountUsage {
  if (!previous) return account
  const newer =
    !previous.checkedAt ||
    (account.checkedAt && Date.parse(account.checkedAt) >= Date.parse(previous.checkedAt))
  const previousStateAt = previous.stateObservedAt ?? previous.checkedAt
  const stateAt = account.stateObservedAt ?? account.checkedAt
  const newerState =
    !previousStateAt || Boolean(stateAt && Date.parse(stateAt) >= Date.parse(previousStateAt))
  const updates = account.windows.filter((window) => {
    const known = previous.windows.find((entry) => entry.id === window.id)
    if (!known?.observedAt) return true
    return Boolean(
      window.observedAt &&
      Date.parse(window.observedAt) >= Date.parse(known.observedAt) &&
      (!window.resetsAt ||
        !known.resetsAt ||
        Date.parse(window.resetsAt) >= Date.parse(known.resetsAt)),
    )
  })
  const control = newerState ? account : previous
  return {
    ...previous,
    ...(newer ? account : {}),
    state: control.state,
    stateObservedAt: control.stateObservedAt,
    routing: control.routing,
    cooldown: control.cooldown ?? null,
    windows: mergeUsageWindows(previous.windows, updates),
  }
}

function accountState(
  account: ProviderAccountUsage,
  windows: ProviderAccountUsage['windows'],
  nowMs: number,
  staleAfterMs: number,
): NonNullable<ProviderAccountUsage['state']> {
  if (account.state === 'disabled') return 'disabled'
  if (account.source === 'cli-proxy-management' && account.state === 'unknown') return 'unknown'
  if (account.state === 'cooldown' && !account.cooldown) return 'unknown'
  if (account.state === 'cooldown' && account.cooldown) {
    if (!account.cooldown.until) {
      const observedAt = account.stateObservedAt ?? account.cooldown.observedAt
      return nowMs - Date.parse(observedAt) < staleAfterMs ? 'cooldown' : 'unknown'
    }
    if (Date.parse(account.cooldown.until) > nowMs) return 'cooldown'
  }
  if (!windows.length) return account.checkedAt ? 'unknown' : 'no-data'
  return windows.some(
    (window) =>
      window.freshness === 'fresh' && (window.usedPercent !== null || window.status !== null),
  )
    ? 'ready'
    : 'unknown'
}

function boundFeed(feed: ProviderUsageFeed): ProviderUsageFeed {
  const bounded: ProviderUsageFeed = { ...feed, accounts: [] }
  for (const account of feed.accounts) {
    const metadata: ProviderUsageFeed['accounts'][number] = {
      ...account,
      state: account.windows.length && account.state === 'ready' ? 'unknown' : account.state,
      windows: [],
    }
    bounded.accounts.push(metadata)
    if (Buffer.byteLength(JSON.stringify(bounded)) <= 64 * 1024) continue
    bounded.accounts.pop()
    break
  }
  for (let index = 0; index < bounded.accounts.length; index += 1) {
    const account = bounded.accounts[index]!
    const windows = feed.accounts[index]!.windows
    for (const window of windows) {
      account.windows.push(window)
      if (Buffer.byteLength(JSON.stringify(bounded)) <= 64 * 1024) continue
      account.windows.pop()
      break
    }
    // The strict v1 contract has no omission field; partial allowance remains unknown.
    const state = feed.accounts[index]!.state
    account.state =
      account.windows.length !== windows.length && state === 'ready' ? 'unknown' : state
  }
  return bounded
}
