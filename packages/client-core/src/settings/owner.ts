import { QueryClient, QueryObserver, notifyManager } from '@tanstack/query-core'
import {
  errorNumberField,
  errorStringField,
  type SettingsOperation,
  type SettingsSnapshot,
  type SettingsWriteTarget,
} from '@workspace/contracts'

import type { Client } from '../transport/client'
import {
  activeSettingsIntentsFor,
  discardFailedSettingsIntent,
  discardSettingsIntent,
  failSettingsIntent,
  retrySettingsIntent,
  settingsIntentStore,
  settleSettingsIntentTransport,
  submitSettingsIntent,
  type ActiveSettingsIntent,
  type SettingsSubmission,
} from './intent-store'
import {
  settingsResultRequiresActiveEpochRetry,
  settingsRetryDelay,
  shouldRetrySettingsTransport,
} from './mutation-policy'
import { projectSettings } from './projection'
import { settingsKeys } from './query-keys'
import { readSettings } from './read'
import { createSettingsSnapshotAdmission } from './snapshot-admission'
import { superviseSettingsStream } from './stream'
import { settingsInvariantError } from './structured-errors'
import { writeSettings, writeSettingsText } from './write'

export type SettingsOwnerOptions = {
  readonly client: Client
  readonly initialSnapshot: SettingsSnapshot
  readonly instanceId: string
  readonly record?: (event: Readonly<Record<string, unknown>>) => void
}

export function createSettingsOwner(options: SettingsOwnerOptions) {
  return new SettingsOwner(options)
}

export class SettingsOwner {
  private readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  private readonly listeners = new Set<() => void>()
  private readonly controller = new AbortController()
  private readonly admission
  private readonly observer
  private readonly unsubscribeQuery
  private readonly unsubscribeIntents
  private readonly options
  private confirmed: SettingsSnapshot
  private state
  private queue: Promise<void> = Promise.resolve()
  private started = false
  private disposed = false

  constructor(options: SettingsOwnerOptions) {
    this.options = options
    this.confirmed = options.initialSnapshot
    this.admission = createSettingsSnapshotAdmission({
      batch: notifyManager.batch,
      fetch: (_owner, signal) => readSettings({ client: options.client, signal }),
      invalidateProviders: () => undefined,
    })
    const accepted = this.admission.observeInitialSettingsSnapshot(
      this.queryClient,
      options.initialSnapshot,
    )
    this.queryClient.setQueryData(settingsKeys.document(), accepted)
    this.state = this.project()
    this.observer = new QueryObserver<SettingsSnapshot>(this.queryClient, {
      queryKey: settingsKeys.document(),
      staleTime: Infinity,
      queryFn: ({ signal }) => this.admission.refreshConfirmedSettings(this.queryClient, signal),
    })
    this.unsubscribeQuery = this.observer.subscribe((result) => {
      if (result.data) this.confirmed = result.data
      this.publish()
    })
    this.unsubscribeIntents = settingsIntentStore.subscribe(() => this.publish())
  }

  getSnapshot = () => this.state

  readSettingsMirror = () => this.confirmed.values

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start() {
    if (this.started || this.controller.signal.aborted) return
    this.started = true
    void superviseSettingsStream(this.queryClient, this.controller.signal, {
      client: this.options.client,
      admission: this.admission,
      record: (event) => this.options.record?.({ ...event, instanceId: this.options.instanceId }),
    })
  }

  refresh = (signal?: AbortSignal) => {
    const signals = [this.controller.signal]
    if (signal) signals.push(signal)
    return this.admission.refreshConfirmedSettings(this.queryClient, AbortSignal.any(signals))
  }

  submit = (
    target: SettingsWriteTarget,
    operations: readonly SettingsOperation[],
    initiator?: string,
  ): SettingsSubmission => {
    if (this.controller.signal.aborted) return { kind: 'noop' }
    const { entry } = submitSettingsIntent(this.queryClient, target, operations, initiator)
    this.enqueue(entry)
    return { kind: 'submitted', mutationId: entry.intentId, settled: entry.settled }
  }

  writeRaw = async (
    target: SettingsWriteTarget,
    text: string,
    baseRevision: string,
    signal?: AbortSignal,
  ) => {
    const requestSignal = signal
      ? AbortSignal.any([this.controller.signal, signal])
      : this.controller.signal
    requestSignal.throwIfAborted()
    const result = await writeSettingsText({
      client: this.options.client,
      signal: requestSignal,
      request: {
        writeId: globalThis.crypto.randomUUID(),
        target,
        text,
        baseRevision,
      },
    })
    requestSignal.throwIfAborted()
    await this.admission.admitSettingsRawResult(this.queryClient, result)
  }

  retry = (mutationId: string) => {
    if (
      this.controller.signal.aborted ||
      !this.state.failures.some((entry) => entry.intentId === mutationId)
    )
      return
    const entry = retrySettingsIntent(mutationId)
    if (entry) this.enqueue(entry)
  }

  discard = (mutationId: string) => {
    if (!this.state.failures.some((entry) => entry.intentId === mutationId)) return
    discardFailedSettingsIntent(mutationId)
    if (this.controller.signal.aborted) this.publish()
  }

  pause() {
    if (this.controller.signal.aborted) return
    this.controller.abort()
    this.unsubscribeQuery()
    this.unsubscribeIntents()
    this.observer.destroy()
    for (const entry of activeSettingsIntentsFor(this.queryClient)) {
      discardSettingsIntent(entry.intentId)
    }
    this.state = this.project()
    for (const listener of this.listeners) listener()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.pause()
    this.admission.resetSettingsSnapshotAdmission(this.queryClient)
    this.listeners.clear()
    for (const entry of this.state.failures) discardFailedSettingsIntent(entry.intentId)
    this.queryClient.clear()
  }

  private project() {
    return {
      snapshot: this.confirmed,
      projection: projectSettings(this.confirmed, activeSettingsIntentsFor(this.queryClient)),
      pendingCount: activeSettingsIntentsFor(this.queryClient).filter(
        (entry) => entry.status === 'pending',
      ).length,
      failures: settingsIntentStore
        .getState()
        .failed.filter((entry) => entry.patch.owner === this.queryClient),
    }
  }

  private publish() {
    if (this.disposed) return
    this.state = this.project()
    for (const listener of this.listeners) listener()
  }

  private enqueue(entry: ActiveSettingsIntent) {
    this.queue = this.queue.then(() => this.transport(entry))
  }

  private async transport(entry: ActiveSettingsIntent) {
    if (this.controller.signal.aborted) return
    const startedAt = performance.now()
    try {
      await this.apply(entry)
      this.recordWrite(entry, startedAt, 'acknowledged')
    } catch (error) {
      if (!this.controller.signal.aborted) failSettingsIntent(entry.intentId, error)
      this.recordWrite(
        entry,
        startedAt,
        this.controller.signal.aborted ? 'cancelled' : 'failed',
        error,
      )
    } finally {
      settleSettingsIntentTransport(entry.intentId)
    }
  }

  private async apply(entry: ActiveSettingsIntent) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.writeWithRetry(entry)
      this.controller.signal.throwIfAborted()
      const initial = await this.admission.admitSettingsMutationResult(this.queryClient, result)
      const admission = initial.confirmation ? await initial.confirmation : initial
      if (!settingsResultRequiresActiveEpochRetry(result, admission)) return
    }
    throw settingsInvariantError('Settings mutation could not establish an active epoch')
  }

  private async writeWithRetry(entry: ActiveSettingsIntent) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.controller.signal.throwIfAborted()
      try {
        return await writeSettings({
          client: this.options.client,
          request: entry.patch.request,
          signal: this.controller.signal,
        })
      } catch (error) {
        if (!shouldRetrySettingsTransport(attempt, error)) throw error
        await new Promise<void>((resolve) =>
          globalThis.setTimeout(resolve, settingsRetryDelay(attempt)),
        )
      }
    }
    throw settingsInvariantError('Settings mutation retries ended without a response')
  }

  private recordWrite(
    entry: ActiveSettingsIntent,
    startedAt: number,
    outcome: string,
    error?: unknown,
  ) {
    this.options.record?.({
      action: 'settings.write',
      area: 'settings',
      instanceId: this.options.instanceId,
      mutationId: entry.intentId,
      target: entry.patch.request.target,
      operationCount: entry.patch.request.operations.length,
      durationMs: performance.now() - startedAt,
      outcome,
      errorCode: errorStringField(error, 'code'),
      errorStatus: errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode'),
    })
  }
}
