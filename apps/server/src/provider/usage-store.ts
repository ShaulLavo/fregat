import type {
  ProviderAccountUsage,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderUsageResult,
  ProviderUsageWindow,
} from '@workspace/contracts'
import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import { isPresent } from '@workspace/utils/objects'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import type { ProviderAdapter, ProviderRuntimeEvent } from './types'
import {
  mergeUsageWindows,
  probedUsageWindows,
  type ProviderUsageProbe,
} from './utils/usage-windows'

/** A probe spawns the provider CLI and, for Codex, calls OpenAI; readings this fresh are enough. */
const PROBE_FRESHNESS_MS = 5 * 60_000
/** The route answers with what it has once a probe runs longer than this; the probe still lands. */
const READ_WAIT_MS = 6_000

type AccountUsage = {
  driverKind: ProviderDriverKind
  planType: string | null
  /** When a reading last confirmed these windows, event or probe. */
  checkedAt: string | null
  /** When the last probe settled, success or failure; the freshness clock. */
  probedAtMs: number | null
  /** No plan limits apply (an API key); stays so until a probe says otherwise. */
  unsupported: boolean
  windows: ProviderUsageWindow[]
}

type UsageAccounts = Pick<ProviderAdapterRegistry, 'adapter' | 'listInstances' | 'usageAccount'>

type AccountTarget = {
  accountKey: string
  adapter: ProviderAdapter | null
  driverKind: ProviderDriverKind
  providerInstanceIds: ProviderInstanceId[]
}

/**
 * The latest plan windows per provider account. Turns stream sparse updates; a probe
 * reads every window at once when nobody has for five minutes, and only while
 * something asks. Memory only: the first read after a restart probes.
 */
export class ProviderUsageStore {
  private readonly accounts = new Map<string, AccountUsage>()
  private readonly probes = new Map<string, Promise<void>>()
  private readonly registry: UsageAccounts
  private readonly now: () => number

  constructor(registry: UsageAccounts, options: { now?: () => number } = {}) {
    this.registry = registry
    this.now = options.now ?? Date.now
  }

  accept(event: ProviderRuntimeEvent) {
    if (event.type !== 'account.rate-limits.updated' || !event.providerInstanceId) return

    const account = this.registry.usageAccount(event.providerInstanceId)
    if (!account) return

    const previous = this.account(account.accountKey, account.driverKind)
    if (previous.unsupported) return

    this.accounts.set(account.accountKey, {
      ...previous,
      checkedAt: event.createdAt,
      planType: event.payload.planType ?? previous.planType,
      windows: mergeUsageWindows(previous.windows, event.payload.windows),
    })
  }

  /** Probes stale accounts first, waiting a bounded time, then answers from memory. */
  async read(): Promise<ProviderUsageResult> {
    const targets = this.targets()
    const probes = targets.map((target) => this.probeIfStale(target)).filter(isPresent)
    if (probes.length > 0) await settledWithin(probes, READ_WAIT_MS)

    return { accounts: targets.map((target) => this.snapshot(target)).filter(isPresent) }
  }

  private targets() {
    const targets = new Map<string, AccountTarget>()
    for (const providerInstanceId of this.registry.listInstances()) {
      const account = this.registry.usageAccount(providerInstanceId)
      if (!account?.enabled) continue

      const target = targets.get(account.accountKey) ?? {
        accountKey: account.accountKey,
        adapter: null,
        driverKind: account.driverKind,
        providerInstanceIds: [],
      }
      target.providerInstanceIds.push(providerInstanceId)
      target.adapter ??= this.registry.adapter(providerInstanceId)
      targets.set(account.accountKey, target)
    }

    return [...targets.values()]
  }

  private probeIfStale(target: AccountTarget) {
    const readUsage = target.adapter?.readUsage?.bind(target.adapter)
    if (!readUsage) return null

    const inFlight = this.probes.get(target.accountKey)
    if (inFlight) return inFlight

    const probedAtMs = this.accounts.get(target.accountKey)?.probedAtMs ?? null
    if (probedAtMs !== null && this.now() - probedAtMs < PROBE_FRESHNESS_MS) return null

    const probe = this.probe(target, readUsage).finally(() => {
      this.probes.delete(target.accountKey)
    })
    this.probes.set(target.accountKey, probe)

    return probe
  }

  private async probe(target: AccountTarget, readUsage: () => Promise<ProviderUsageProbe>) {
    const startedAtMs = this.now()
    try {
      const result = await readUsage()
      this.applyProbe(target, result)
      recordChatPipelineInfo('chat.pipeline.provider_usage.probe', {
        driverKind: target.driverKind,
        durationMs: this.now() - startedAtMs,
        outcome: result.kind,
        usageWindows: this.accounts.get(target.accountKey)?.windows.map(windowSummary) ?? [],
      })
    } catch (error) {
      // A failed read keeps the windows a turn or an earlier probe established.
      const previous = this.account(target.accountKey, target.driverKind)
      this.accounts.set(target.accountKey, { ...previous, probedAtMs: this.now() })
      recordChatPipelineWarning('chat.pipeline.provider_usage.probe_failed', {
        driverKind: target.driverKind,
        durationMs: this.now() - startedAtMs,
        error,
      })
    }
  }

  private applyProbe(target: AccountTarget, result: ProviderUsageProbe) {
    const previous = this.account(target.accountKey, target.driverKind)
    const probedAtMs = this.now()
    if (result.kind === 'unsupported') {
      this.accounts.set(target.accountKey, {
        ...previous,
        probedAtMs,
        unsupported: true,
        windows: [],
      })
      return
    }

    this.accounts.set(target.accountKey, {
      ...previous,
      checkedAt: new Date(probedAtMs).toISOString(),
      planType: result.update.planType ?? previous.planType,
      probedAtMs,
      unsupported: false,
      windows: probedUsageWindows(result.update.windows),
    })
  }

  /** A window whose reset has passed says nothing true any more, so it leaves the answer. */
  private snapshot(target: AccountTarget): ProviderAccountUsage | null {
    const usage = this.accounts.get(target.accountKey)
    if (!usage?.checkedAt || usage.unsupported) return null

    const nowMs = this.now()
    const windows = usage.windows.filter(
      (window) => !window.resetsAt || Date.parse(window.resetsAt) > nowMs,
    )
    if (windows.length === 0) return null

    return {
      accountKey: target.accountKey,
      checkedAt: usage.checkedAt,
      driverKind: usage.driverKind,
      planType: usage.planType,
      providerInstanceIds: target.providerInstanceIds,
      windows,
    }
  }

  private account(accountKey: string, driverKind: ProviderDriverKind): AccountUsage {
    return (
      this.accounts.get(accountKey) ?? {
        checkedAt: null,
        driverKind,
        planType: null,
        probedAtMs: null,
        unsupported: false,
        windows: [],
      }
    )
  }
}

function windowSummary(window: ProviderUsageWindow) {
  return `${window.id}:${window.status ?? 'unknown'}`
}

async function settledWithin(promises: readonly Promise<void>[], timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([Promise.allSettled(promises), timeout])
  } finally {
    clearTimeout(timer)
  }
}
