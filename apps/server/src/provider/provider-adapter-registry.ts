import { createHash } from 'node:crypto'
import type { SessionId } from '@workspace/contracts'
import type { AgentTerminalProcess } from '../terminal/agent-launch'

export type AgentTerminalReservation = Omit<AgentTerminalProcess, 'command'> & {
  readonly resolveCommand: () => Promise<AgentTerminalProcess['command']>
}
import { sessionIdentityErrors } from './structured-errors'
import { claudeTerminalResumeArgv } from './utils/claude-terminal-resume'
import { createInternalError } from '../observability/structured-errors'

import {
  jsonEqual,
  providerListResultSchema,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderListResult,
  type ProviderSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import { ProviderCredentialWatch } from './credential-watch'
import type { AnyProviderDriver, ProviderInstanceConfig } from './driver'
import { DEFAULT_PROVIDER_INSTANCES, productProviderDrivers } from './drivers/built-in'
import { defaultProviderStatusCacheDir, ProviderStatusCache } from './status-cache'
import type { ProviderAdapter } from './types'
import { mergeProviderInstanceConfigs } from './utils/instance-config-merge'
import { resolveProviderInstanceEnvironment } from './utils/instance-environment'

export type ProviderInstanceRoutingInfo = {
  displayLabel: string
  driverKind: ProviderAdapter['driverKind']
  enabled: boolean
  providerInstanceId: ProviderInstanceId
}

export type ProviderAdapterRegistryChange = {
  providerInstanceIds: ProviderInstanceId[]
  type: 'providers.changed'
}

export type ProviderAdapterRegistryChangeListener = (
  change: ProviderAdapterRegistryChange,
) => Promise<void> | void

export type ProviderAdapterLease = {
  adapter: ProviderAdapter
  release: () => void
}

export type ProviderAdapterRegistryOptions = {
  /** Pre-materialized adapters, for tests and for the deterministic harness. */
  adapters?: readonly ProviderAdapter[]
  drivers?: readonly AnyProviderDriver[]
  statusCache?: ProviderStatusCache
  /**
   * Whether an instance is still serving a session.
   *
   * Injected rather than looked up: the registry owns adapters, not the session
   * directory, and making it read the database directly would tie provider
   * configuration to the orchestration schema.
   */
  hasLiveSessions?: (providerInstanceId: ProviderInstanceId) => boolean | Promise<boolean>
}

type LiveProviderInstance = {
  env: NodeJS.ProcessEnv
  adapter: ProviderAdapter
  config: ProviderInstanceConfig
  credentialPaths: readonly string[]
  dispose: () => Promise<void>
}

/**
 * Owns the live instance map. A *driver* says how to talk to a provider; an
 * *instance* is one account of it. Instances are created and torn down by
 * `reconcile`, so adding a second Codex account is a settings edit, not a
 * server restart, and removing one takes its child processes with it.
 */
export class ProviderAdapterRegistry {
  private readonly activeLeaseCounts = new Map<ProviderInstanceId, number>()
  private readonly changeListeners = new Set<ProviderAdapterRegistryChangeListener>()
  private readonly credentialWatch = new ProviderCredentialWatch((providerInstanceIds) => {
    void this.refreshInstances(providerInstanceIds)
  })
  private readonly drivers = new Map<ProviderDriverKind, AnyProviderDriver>()
  private readonly hasLiveSessions: (
    providerInstanceId: ProviderInstanceId,
  ) => boolean | Promise<boolean>
  private readonly instances = new Map<ProviderInstanceId, LiveProviderInstance>()
  private readonly leaseDeferredInstances = new Set<ProviderInstanceId>()
  private desiredEntries: readonly ProviderInstanceConfig[] | null = null
  private disposed = false
  private reconcileChain: Promise<void> = Promise.resolve()
  private readonly statusCache: ProviderStatusCache
  private readonly unavailable = new Map<ProviderInstanceId, ProviderSnapshot>()

  /** An array is shorthand for `{ adapters }` — the shape tests and harnesses use. */
  constructor(options: ProviderAdapterRegistryOptions | readonly ProviderAdapter[] = {}) {
    const resolved = Array.isArray(options)
      ? { adapters: options as readonly ProviderAdapter[] }
      : (options as ProviderAdapterRegistryOptions)
    this.statusCache = resolved.statusCache ?? new ProviderStatusCache()
    this.hasLiveSessions = resolved.hasLiveSessions ?? (() => false)
    for (const driver of resolved.drivers ?? []) {
      this.registerDriver(driver)
    }
    for (const adapter of resolved.adapters ?? []) {
      this.adopt(adapter)
    }
  }

  registerDriver(driver: AnyProviderDriver) {
    this.drivers.set(driver.driverKind, driver)
  }

  /**
   * Diffs settings against the live map: untouched entries keep their adapter
   * (and their running sessions), changed and removed ones are disposed, new
   * ones are created. An entry naming a driver this build does not ship becomes
   * an unavailable snapshot instead of an error.
   */
  reconcile(entries: readonly ProviderInstanceConfig[]) {
    if (this.disposed) {
      recordChatPipelineWarning('chat.pipeline.provider_registry.reconcile_after_dispose', {
        requestedInstanceCount: entries.length,
      })
      return Promise.resolve()
    }

    const desiredEntries = entries.slice()
    this.desiredEntries = desiredEntries
    // Serialized: two settings writes landing together would otherwise
    // interleave create and dispose over the same instance map.
    return this.queueReconcile(() => desiredEntries)
  }

  private async applyReconcile(entries: readonly ProviderInstanceConfig[]) {
    const seen = new Set<ProviderInstanceId>()
    const nextUnavailable = new Map<ProviderInstanceId, ProviderSnapshot>()
    const instanceCountByKind = new Map<ProviderDriverKind, number>()

    for (const entry of entries) {
      if (seen.has(entry.providerInstanceId)) {
        recordChatPipelineWarning('chat.pipeline.provider_registry.duplicate_instance', {
          providerInstanceId: entry.providerInstanceId,
        })
        continue
      }
      seen.add(entry.providerInstanceId)
      const count = (instanceCountByKind.get(entry.driverKind) ?? 0) + 1
      instanceCountByKind.set(entry.driverKind, count)
      const failure = await this.materialize(entry, count)
      if (failure) nextUnavailable.set(entry.providerInstanceId, failure)
    }

    for (const [providerInstanceId, instance] of this.instances) {
      if (seen.has(providerInstanceId)) continue

      this.leaseDeferredInstances.delete(providerInstanceId)

      // Disposing an adapter mid-turn kills the child process a streaming
      // session is reading from, and sessions route by `providerInstanceId`, so
      // the turn would fail with whatever the transport happened to throw. The
      // The instance stays alive until its current use ends. Utility leases
      // replay the desired state on release; persisted sessions wait for a later reconcile.
      if (await this.hasLiveUsage(providerInstanceId)) {
        const activeLeaseCount = this.activeLeaseCounts.get(providerInstanceId) ?? 0
        if (activeLeaseCount > 0) this.leaseDeferredInstances.add(providerInstanceId)
        recordChatPipelineWarning('chat.pipeline.provider_registry.dispose_deferred', {
          activeLeaseCount,
          providerInstanceId,
        })
        continue
      }

      this.instances.delete(providerInstanceId)
      this.statusCache.forget(providerInstanceId)
      await disposeInstance(providerInstanceId, instance)
    }

    this.unavailable.clear()
    for (const [providerInstanceId, snapshot] of nextUnavailable) {
      this.unavailable.set(providerInstanceId, snapshot)
    }
    this.reorderInstances(entries)

    recordChatPipelineInfo('chat.pipeline.provider_registry.reconcile', {
      instanceCount: this.instances.size,
      providerInstanceIds: this.listInstances(),
      unavailableCount: this.unavailable.size,
    })
    this.resetCredentialWatch()
    this.emitChanges()
  }

  async listProviders(): Promise<ProviderListResult> {
    const live = await Promise.all(
      this.listInstances().map((providerInstanceId) => this.snapshot(providerInstanceId)),
    )
    const providers = [...live, ...this.unavailable.values()]

    return v.parse(providerListResultSchema, {
      providers: providers.toSorted(compareProviderSnapshots),
    })
  }

  listInstances() {
    return Array.from(this.instances.keys())
  }

  /**
   * Instances whose credentials live in the same files are one account, so they share one
   * usage meter. Hashed: the key crosses the wire, and a home path is not the client's business.
   */
  usageAccount(providerInstanceId: ProviderInstanceId) {
    const instance = this.instances.get(providerInstanceId)
    if (!instance) return null

    const credentials =
      instance.credentialPaths.length > 0
        ? instance.credentialPaths.toSorted().join('\0')
        : `instance:${providerInstanceId}`
    const accountKey = createHash('sha256')
      .update(`${instance.config.driverKind}\0${credentials}`)
      .digest('hex')
      .slice(0, 16)

    return {
      accountKey,
      driverKind: instance.config.driverKind,
      enabled: instance.config.enabled !== false,
    }
  }

  importSources() {
    return [...this.instances.values()]
      .filter(
        ({ adapter, config }) =>
          config.enabled !== false && adapter.discoverSessions && adapter.readSessionHistory,
      )
      .map(({ config }) => ({
        providerInstanceId: config.providerInstanceId,
        label: config.displayLabel,
        driverKind: config.driverKind,
      }))
  }

  register(adapter: ProviderAdapter) {
    this.adopt(adapter)
    this.resetCredentialWatch()
    this.emitChanges()
  }

  unregister(providerInstanceId: ProviderInstanceId) {
    const instance = this.instances.get(providerInstanceId)
    if (!instance) return false

    this.instances.delete(providerInstanceId)
    this.statusCache.forget(providerInstanceId)
    void disposeInstance(providerInstanceId, instance)
    this.resetCredentialWatch()
    this.emitChanges()

    return true
  }

  subscribeChanges(listener: ProviderAdapterRegistryChangeListener) {
    this.changeListeners.add(listener)
    // Credential watching costs file handles, so it runs only while someone is
    // listening for the resulting availability change.
    this.resetCredentialWatch()

    return () => {
      this.changeListeners.delete(listener)
      this.resetCredentialWatch()
    }
  }

  /** Ends when `signal` aborts, which also releases a consumer parked in `next()`. */
  streamChanges(signal: AbortSignal): AsyncIterable<ProviderAdapterRegistryChange> {
    return providerAdapterRegistryChangeStream(this, signal)
  }

  adapter(providerInstanceId: ProviderInstanceId) {
    return this.instances.get(providerInstanceId)?.adapter ?? null
  }

  getByInstance(providerInstanceId: ProviderInstanceId) {
    const adapter = this.adapter(providerInstanceId)
    if (!adapter) throw createInternalError(`Provider instance not found: ${providerInstanceId}`)

    return adapter
  }

  /** Keeps a utility turn's adapter alive across settings reconciliation. */
  acquireInstanceLease(providerInstanceId: ProviderInstanceId): ProviderAdapterLease {
    const adapter = this.getByInstance(providerInstanceId)
    const count = (this.activeLeaseCounts.get(providerInstanceId) ?? 0) + 1
    this.activeLeaseCounts.set(providerInstanceId, count)
    let released = false

    return {
      adapter,
      release: () => {
        if (released) return

        released = true
        this.releaseInstanceLease(providerInstanceId)
      },
    }
  }

  /** Checks and leases synchronously; the command resolves after the caller claims the session. */
  acquireTerminalLaunch(
    providerInstanceId: ProviderInstanceId,
    sessionId: SessionId,
  ): AgentTerminalReservation {
    const instance = this.instances.get(providerInstanceId)
    if (!instance || instance.config.driverKind !== 'claude' || instance.config.enabled === false)
      throw sessionIdentityErrors.TERMINAL_UNSUPPORTED({
        internal: {
          providerInstanceId,
          sessionId,
          registered: Boolean(instance),
          driverKind: instance?.config.driverKind ?? null,
          enabled: instance?.config.enabled ?? null,
        },
      })
    const lease = this.acquireInstanceLease(providerInstanceId)
    const [, ...args] = claudeTerminalResumeArgv(sessionId)
    const adapter = lease.adapter
    return {
      env: instance.env,
      release: lease.release,
      resolveCommand: async () => [(await adapter.executablePath?.()) ?? 'claude', ...args],
    }
  }

  async getInstanceRoutingInfo(
    providerInstanceId: ProviderInstanceId,
  ): Promise<ProviderInstanceRoutingInfo> {
    const snapshot = await this.snapshot(providerInstanceId)

    return {
      displayLabel: snapshot.displayLabel,
      driverKind: snapshot.driverKind,
      enabled: snapshot.enabled,
      providerInstanceId: snapshot.providerInstanceId,
    }
  }

  async snapshot(providerInstanceId: ProviderInstanceId) {
    const cached = this.statusCache.get(providerInstanceId)
    if (cached) return cached

    const instance = this.instances.get(providerInstanceId)
    const hydrated = instance
      ? this.statusCache.hydrate(providerInstanceId, instance.config.driverKind)
      : null
    if (!hydrated) return this.refreshSnapshot(providerInstanceId)

    // A cold process renders the last known state immediately and re-probes
    // behind it, so the first `/providers` never waits on a CLI.
    void this.refreshInstances([providerInstanceId])

    return hydrated
  }

  /**
   * Bypasses the status cache. Sign-in and sign-out change auth state directly,
   * and the cached snapshot would otherwise keep reporting the old state for the
   * rest of its TTL — i.e. a user who just signed in still sees "not signed in".
   */
  async refreshSnapshot(providerInstanceId: ProviderInstanceId) {
    const adapter = this.getByInstance(providerInstanceId)
    const previous = this.statusCache.last(providerInstanceId, adapter.driverKind)
    const snapshot = withRememberedModels(await adapter.snapshot(), previous)
    this.statusCache.set(snapshot)

    return snapshot
  }

  /** Releases every instance. Nothing the registry spawned may outlive this. */
  async dispose() {
    if (this.disposed) return

    this.disposed = true
    this.desiredEntries = null
    this.leaseDeferredInstances.clear()
    this.changeListeners.clear()
    await this.reconcileChain
    this.credentialWatch.stop()
    const instances = Array.from(this.instances.entries())
    this.instances.clear()
    this.activeLeaseCounts.clear()
    for (const [providerInstanceId, instance] of instances) {
      await disposeInstance(providerInstanceId, instance)
    }
    recordChatPipelineInfo('chat.pipeline.provider_registry.disposed', {
      instanceCount: instances.length,
    })
  }

  private adopt(adapter: ProviderAdapter) {
    const providerInstanceId = adapter.adapterKey as ProviderInstanceId
    this.instances.set(providerInstanceId, {
      adapter,
      config: { driverKind: adapter.driverKind, providerInstanceId },
      env: process.env,
      credentialPaths: [],
      dispose: () => adapter.stopAll(),
    })
  }

  /** Returns an unavailable snapshot when the entry cannot be materialized. */
  private async materialize(entry: ProviderInstanceConfig, instanceCountForKind: number) {
    this.leaseDeferredInstances.delete(entry.providerInstanceId)
    const driver = this.drivers.get(entry.driverKind)
    if (!driver) {
      return unavailableSnapshot(entry, `Driver '${entry.driverKind}' is not registered.`)
    }
    if (!driver.capabilities.multiInstance && instanceCountForKind > 1) {
      return unavailableSnapshot(
        entry,
        `Driver '${entry.driverKind}' supports only one instance at a time.`,
      )
    }

    const existing = this.instances.get(entry.providerInstanceId)
    if (existing && configEqual(existing.config, entry)) return null
    // The same rule the removal loop follows, for the path a *disable* actually
    // takes: switching a provider off rewrites its entry rather than dropping
    // it, so it arrives here as a config change. Replacing the adapter now would
    // dispose the child process a streaming turn is reading from — the exact
    // thing deferring disposal exists to prevent. The old adapter keeps serving
    // Utility leases replay the config on release; persisted sessions wait for a later reconcile.
    if (existing && (await this.hasLiveUsage(entry.providerInstanceId))) {
      const activeLeaseCount = this.activeLeaseCounts.get(entry.providerInstanceId) ?? 0
      if (activeLeaseCount > 0) this.leaseDeferredInstances.add(entry.providerInstanceId)
      recordChatPipelineWarning('chat.pipeline.provider_registry.reconfigure_deferred', {
        activeLeaseCount,
        providerInstanceId: entry.providerInstanceId,
      })

      return null
    }
    if (existing) {
      this.instances.delete(entry.providerInstanceId)
      await disposeInstance(entry.providerInstanceId, existing)
    }

    try {
      await this.create(driver, entry)
      return null
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_registry.instance_failed', {
        driverKind: entry.driverKind,
        error,
        providerInstanceId: entry.providerInstanceId,
      })
      return unavailableSnapshot(entry, instanceFailureMessage(entry, error))
    }
  }

  private async create(driver: AnyProviderDriver, entry: ProviderInstanceConfig) {
    const config = driver.parseConfig(entry.config ?? driver.defaultConfig())
    const env = resolveProviderInstanceEnvironment({
      derived: driver.environment(config),
      overrides: entry.environment,
    })
    const handle = await driver.create({
      ...(entry.binaryPath ? { binaryPath: entry.binaryPath } : {}),
      config,
      displayLabel: entry.displayLabel ?? driver.displayName,
      enabled: entry.enabled ?? true,
      env,
      providerInstanceId: entry.providerInstanceId,
    })

    this.instances.set(entry.providerInstanceId, {
      adapter: handle.adapter,
      config: entry,
      env,
      credentialPaths: driver.credentialPaths({ config, env }),
      dispose: handle.dispose,
    })
    // A recycled id must not inherit the previous account's auth state.
    this.statusCache.forget(entry.providerInstanceId)
  }

  private async refreshInstances(providerInstanceIds: readonly ProviderInstanceId[]) {
    const changed: ProviderInstanceId[] = []
    for (const providerInstanceId of providerInstanceIds) {
      const instance = this.instances.get(providerInstanceId)
      if (!instance) continue

      const before = this.statusCache.last(providerInstanceId, instance.config.driverKind)
      const after = await this.refreshSnapshot(providerInstanceId).catch((error) => {
        recordChatPipelineWarning('chat.pipeline.provider_registry.refresh_failed', {
          error,
          providerInstanceId,
        })
        return null
      })
      if (after && !sameAvailability(before, after)) changed.push(providerInstanceId)
    }

    if (changed.length === 0) return

    recordChatPipelineInfo('chat.pipeline.provider_registry.availability_changed', {
      providerInstanceIds: changed,
    })
    this.emitChanges()
  }

  /** Keeps `listInstances()` in settings-author order rather than creation order. */
  private reorderInstances(entries: readonly ProviderInstanceConfig[]) {
    const ordered: Array<[ProviderInstanceId, LiveProviderInstance]> = []
    const listed = new Set<ProviderInstanceId>()
    for (const entry of entries) {
      const instance = this.instances.get(entry.providerInstanceId)
      if (!instance) continue

      listed.add(entry.providerInstanceId)
      ordered.push([entry.providerInstanceId, instance])
    }

    // An instance whose disposal was deferred is not in `entries` any more, so
    // rebuilding the map purely from them would drop it here — undoing the
    // deferral and leaving a live session pointing at an adapter the registry no
    // longer lists. Kept at the end: it is on its way out, just not yet.
    for (const [providerInstanceId, instance] of this.instances) {
      if (listed.has(providerInstanceId)) continue

      ordered.push([providerInstanceId, instance])
    }

    this.instances.clear()
    for (const [providerInstanceId, instance] of ordered) {
      this.instances.set(providerInstanceId, instance)
    }
  }

  private resetCredentialWatch() {
    if (this.changeListeners.size === 0) {
      this.credentialWatch.stop()
      return
    }

    this.credentialWatch.reset(
      Array.from(this.instances.entries()).map(([providerInstanceId, instance]) => ({
        paths: instance.credentialPaths,
        providerInstanceId,
      })),
    )
  }

  private async hasLiveUsage(providerInstanceId: ProviderInstanceId) {
    if ((this.activeLeaseCounts.get(providerInstanceId) ?? 0) > 0) return true

    return this.hasLiveSessions(providerInstanceId)
  }

  private releaseInstanceLease(providerInstanceId: ProviderInstanceId) {
    const count = this.activeLeaseCounts.get(providerInstanceId) ?? 0
    if (count > 1) {
      this.activeLeaseCounts.set(providerInstanceId, count - 1)
      return
    }

    this.activeLeaseCounts.delete(providerInstanceId)
    if (!this.leaseDeferredInstances.delete(providerInstanceId)) return

    this.reconcileAfterLeaseRelease(providerInstanceId)
  }

  private reconcileAfterLeaseRelease(providerInstanceId: ProviderInstanceId) {
    if (this.disposed) return
    if (!this.desiredEntries) return

    recordChatPipelineInfo('chat.pipeline.provider_registry.lease_reconcile', {
      desiredInstanceCount: this.desiredEntries.length,
      providerInstanceId,
    })
    void this.queueReconcile(() => this.desiredEntries).catch((error) => {
      recordChatPipelineWarning('chat.pipeline.provider_registry.lease_reconcile_failed', {
        error,
        providerInstanceId,
      })
    })
  }

  private queueReconcile(entries: () => readonly ProviderInstanceConfig[] | null) {
    const run = this.reconcileChain.then(async () => {
      if (this.disposed) return

      const desiredEntries = entries()
      if (!desiredEntries) return

      await this.applyReconcile(desiredEntries)
    })
    this.reconcileChain = run.catch(() => {})

    return run
  }

  private emitChanges() {
    const change = {
      providerInstanceIds: this.listInstances(),
      type: 'providers.changed' as const,
    }
    for (const listener of this.changeListeners) {
      void Promise.resolve(listener(change))
    }
  }
}

/**
 * The product registry: built-in drivers, one instance each, status cached on
 * disk so a cold start renders providers without waiting on a CLI probe.
 */
export function createDefaultProviderAdapterRegistry(
  savedInstances: readonly ProviderInstanceConfig[] = [],
  options: {
    hasLiveSessions?: (providerInstanceId: ProviderInstanceId) => boolean | Promise<boolean>
  } = {},
) {
  const registry = new ProviderAdapterRegistry({
    drivers: productProviderDrivers(),
    hasLiveSessions: options.hasLiveSessions,
    statusCache: new ProviderStatusCache({ directory: defaultProviderStatusCacheDir() }),
  })
  // Reconciled against the settings document rather than a constant. Passing
  // `DEFAULT_PROVIDER_INSTANCES` straight through is what made every
  // configurable field on `providerInstanceConfigSchema` unreadable: the
  // contract carried them, the settings service stored them, and the only
  // caller of `reconcile` never looked.
  void registry.reconcile(mergeProviderInstanceConfigs(DEFAULT_PROVIDER_INSTANCES, savedInstances))

  return registry
}

async function disposeInstance(
  providerInstanceId: ProviderInstanceId,
  instance: LiveProviderInstance,
) {
  try {
    await instance.dispose()
  } catch (error) {
    recordChatPipelineWarning('chat.pipeline.provider_registry.dispose_failed', {
      error,
      providerInstanceId,
    })
  }
}

/**
 * A transient probe failure must not empty the model picker mid-session: an
 * errored snapshot keeps whatever models the last good probe reported.
 */
function withRememberedModels(snapshot: ProviderSnapshot, previous: ProviderSnapshot | null) {
  if (snapshot.models.length > 0) return snapshot
  if (!previous || previous.models.length === 0) return snapshot
  if (snapshot.status === 'ready') return snapshot

  return { ...snapshot, models: previous.models }
}

function sameAvailability(before: ProviderSnapshot | null, after: ProviderSnapshot) {
  if (!before) return false

  return (
    before.auth.status === after.auth.status &&
    before.availability === after.availability &&
    before.installed === after.installed &&
    before.status === after.status
  )
}

function instanceFailureMessage(entry: ProviderInstanceConfig, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)

  return `Provider instance '${entry.providerInstanceId}' could not be created: ${detail}`
}

function unavailableSnapshot(entry: ProviderInstanceConfig, reason: string): ProviderSnapshot {
  return {
    auth: { status: 'unknown' },
    availability: 'unavailable',
    checkedAt: new Date().toISOString(),
    displayLabel: entry.displayLabel ?? entry.driverKind,
    driverKind: entry.driverKind,
    enabled: false,
    installed: false,
    message: reason,
    models: [],
    providerInstanceId: entry.providerInstanceId,
    runtimeModes: [],
    status: 'error',
    traits: {
      supportsApprovals: false,
      supportsFullAccess: false,
      supportsInterrupt: false,
      supportsSessionStop: false,
      supportsStreaming: false,
      supportsUserInput: false,
    },
    version: null,
  }
}

function configEqual(left: ProviderInstanceConfig, right: ProviderInstanceConfig) {
  return jsonEqual(left, right)
}

function compareProviderSnapshots(left: ProviderSnapshot, right: ProviderSnapshot) {
  return (
    left.displayLabel.localeCompare(right.displayLabel) ||
    left.driverKind.localeCompare(right.driverKind) ||
    left.providerInstanceId.localeCompare(right.providerInstanceId)
  )
}

function providerAdapterRegistryChangeStream(
  adapterRegistry: ProviderAdapterRegistry,
  signal: AbortSignal,
) {
  return {
    async *[Symbol.asyncIterator]() {
      if (signal.aborted) return

      const queue: ProviderAdapterRegistryChange[] = []
      const waiters: Array<() => void> = []
      const wakeAll = () => {
        for (const wake of waiters.splice(0)) wake()
      }
      const unsubscribe = adapterRegistry.subscribeChanges((change) => {
        queue.push(change)
        waiters.shift()?.()
      })
      signal.addEventListener('abort', wakeAll, { once: true })

      try {
        while (!signal.aborted) {
          const change = queue.shift()
          if (change) {
            yield change
            continue
          }

          await new Promise<void>((resolve) => {
            waiters.push(resolve)
          })
        }
      } finally {
        signal.removeEventListener('abort', wakeAll)
        unsubscribe()
        wakeAll()
      }
    },
  }
}
