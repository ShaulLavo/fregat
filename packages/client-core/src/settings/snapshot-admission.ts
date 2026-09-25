import {
  applySettingsOperations,
  type SettingId,
  type SettingsEvent,
  type SettingsMutationResult,
  type SettingsRawWriteResult,
  type SettingsSnapshot,
} from '@workspace/contracts'
import type { QueryClient } from '@tanstack/query-core'

import { settingsInvariantError as createClientInvariantError } from './structured-errors'

import {
  acknowledgeSettingsIntent,
  settingsIntentStatus,
  type ActiveSettingsIntent,
  settingsIntentStore,
} from './intent-store'

import { settingsKeys } from './query-keys'

type AdmissionState = {
  activeEpoch: string | null
  readonly deferred: DeferredSettingsUpdate[]
  deferredScheduled: boolean
  disposed: boolean
  lastConfirmed: SettingsSnapshot | undefined
  latestCompletedReadGeneration: number
  latestInvalidatedProviderReadGeneration: number
  nextReadGeneration: number
  readonly recoveryLifetime: string
  readonly retiredEpochs: Set<string>
}

export type SettingsSnapshotReadToken = {
  readonly generation: number
  readonly owner: object
}

type DeferredSettingsUpdate = {
  readonly confirmation: Promise<AdmissionResult>
  readonly resolve: (result: AdmissionResult) => void
  readonly update: SettingsUpdate
}

type SettingsUpdate = {
  readonly changedSettingIds: readonly SettingId[]
  readonly originMutationId?: string
  readonly snapshot: SettingsSnapshot
}

type ConfirmedSettingsRefresh = {
  readonly providerChangeGeneration: number | null
  readonly snapshot: SettingsSnapshot
}

type AdmissionResult = {
  readonly acknowledgedIntent: ActiveSettingsIntent | null
  readonly admitted: boolean
  readonly confirmation?: Promise<AdmissionResult>
  readonly recoveryPending: boolean
  readonly snapshot: SettingsSnapshot | undefined
}

function inactiveAdmission(): AdmissionResult {
  return { acknowledgedIntent: null, admitted: false, recoveryPending: false, snapshot: undefined }
}

export type SettingsAdmissionHost = {
  readonly batch: (operation: () => void) => void
  readonly fetch: (owner: QueryClient, signal?: AbortSignal) => Promise<SettingsSnapshot>
  readonly invalidateProviders: (owner: QueryClient) => void
}

export function createSettingsSnapshotAdmission(host: SettingsAdmissionHost) {
  const stateByClient = new WeakMap<QueryClient, AdmissionState>()

  /** Marks when a confirmed GET starts so an older response cannot switch epochs later. */
  function beginSettingsSnapshotRead(queryClient: QueryClient): SettingsSnapshotReadToken {
    const state = admissionState(queryClient)
    state.nextReadGeneration += 1

    return { generation: state.nextReadGeneration, owner: state }
  }

  /** Establishes or advances confirmed state for a query-owned GET response. */
  function observeInitialSettingsSnapshot(
    queryClient: QueryClient,
    snapshot: SettingsSnapshot,
    token: SettingsSnapshotReadToken = beginSettingsSnapshotRead(queryClient),
  ): SettingsSnapshot {
    const state = admissionState(queryClient)
    const current = confirmedSnapshot(queryClient) ?? state.lastConfirmed
    if (token.owner !== state || token.generation < state.latestCompletedReadGeneration) {
      if (current) return current

      throw createClientInvariantError('A stale settings read has no confirmed replacement')
    }

    state.latestCompletedReadGeneration = token.generation
    let accepted = snapshot
    if (state.retiredEpochs.has(snapshot.serverVersion.epoch)) {
      if (!current) {
        throw createClientInvariantError('A retired settings epoch has no confirmed replacement')
      }

      accepted = current
    }
    if (!current) {
      state.activeEpoch = snapshot.serverVersion.epoch
    } else if (current.serverVersion.epoch === snapshot.serverVersion.epoch) {
      accepted =
        snapshot.serverVersion.sequence > current.serverVersion.sequence ? snapshot : current
    } else if (!state.retiredEpochs.has(snapshot.serverVersion.epoch)) {
      retireActiveEpoch(state)
      state.activeEpoch = snapshot.serverVersion.epoch
    }

    state.lastConfirmed = accepted
    scheduleDeferredAdmissions(queryClient, state)
    return accepted
  }

  async function admitSettingsMutationResult(
    queryClient: QueryClient,
    result: SettingsMutationResult,
  ): Promise<AdmissionResult> {
    return admitSettingsUpdate(queryClient, {
      changedSettingIds: result.changedSettingIds,
      originMutationId: result.mutationId,
      snapshot: result.snapshot,
    })
  }

  async function admitSettingsEvent(
    queryClient: QueryClient,
    event: SettingsEvent,
  ): Promise<AdmissionResult> {
    return admitSettingsUpdate(queryClient, event)
  }

  async function admitSettingsRawResult(
    queryClient: QueryClient,
    result: SettingsRawWriteResult,
  ): Promise<AdmissionResult> {
    return admitSettingsUpdate(queryClient, {
      changedSettingIds: result.changedSettingIds,
      snapshot: result.snapshot,
    })
  }

  /** Refetches confirmed bytes after a stream break or raw compare-and-swap conflict. */
  async function refreshConfirmedSettings(queryClient: QueryClient, signal?: AbortSignal) {
    const refreshed = await refreshConfirmedSettingsWithEvidence(queryClient, signal)
    const state = admissionState(queryClient)
    invalidateProviderQueries(queryClient, claimProviderChange(state, refreshed))

    return refreshed.snapshot
  }

  async function refreshConfirmedSettingsWithEvidence(
    queryClient: QueryClient,
    signal?: AbortSignal,
  ): Promise<ConfirmedSettingsRefresh> {
    const token = beginSettingsSnapshotRead(queryClient)
    const snapshot = await host.fetch(queryClient, signal)
    signal?.throwIfAborted()
    const state = admissionState(queryClient)
    const previous = confirmedSnapshot(queryClient) ?? state.lastConfirmed
    const accepted = observeInitialSettingsSnapshot(queryClient, snapshot, token)
    host.batch(() => {
      queryClient.setQueryData(settingsKeys.document(), accepted)
    })

    return {
      providerChangeGeneration:
        previous && providersChanged(previous, accepted) ? token.generation : null,
      snapshot: accepted,
    }
  }

  function resetSettingsSnapshotAdmission(queryClient: QueryClient) {
    const state = stateByClient.get(queryClient)
    if (state) {
      state.disposed = true
      queryClient.removeQueries({
        queryKey: settingsKeys.recovery(state.recoveryLifetime),
        exact: true,
      })
      for (const deferred of state.deferred) {
        deferred.resolve(inactiveAdmission())
      }
      state.deferred.splice(0)
    }
    stateByClient.delete(queryClient)
  }

  async function admitSettingsUpdate(
    queryClient: QueryClient,
    update: SettingsUpdate,
    deferred?: DeferredSettingsUpdate,
  ): Promise<AdmissionResult> {
    const state = admissionState(queryClient)
    let recoveredProviderChange = false
    const recoveryState = queryClient.getQueryState(settingsKeys.recovery(state.recoveryLifetime))
    if (recoveryState && recoveryState.fetchStatus !== 'idle') {
      try {
        const recovery = await recoverUnexpectedEpoch(queryClient)
        if (state.disposed) return inactiveAdmission()
        recoveredProviderChange = claimProviderChange(state, recovery)
      } catch {
        return deferredAdmission(queryClient, state, update, deferred)
      }
    }
    if (state.retiredEpochs.has(update.snapshot.serverVersion.epoch)) {
      invalidateProviderQueries(queryClient, recoveredProviderChange)
      return retiredAdmission(queryClient)
    }

    let current = confirmedSnapshot(queryClient) ?? state.lastConfirmed
    if (!current || current.serverVersion.epoch !== update.snapshot.serverVersion.epoch) {
      try {
        const recovery = await recoverUnexpectedEpoch(queryClient)
        if (state.disposed) return inactiveAdmission()
        current = recovery.snapshot
        const providerChange = claimProviderChange(state, recovery)
        recoveredProviderChange = providerChange || recoveredProviderChange
      } catch {
        if (state.disposed) return inactiveAdmission()
        void queryClient.invalidateQueries({ queryKey: settingsKeys.document() })
        return deferredAdmission(queryClient, state, update, deferred)
      }
      if (current.serverVersion.epoch !== update.snapshot.serverVersion.epoch) {
        state.retiredEpochs.add(update.snapshot.serverVersion.epoch)
        return confirmedEvidenceAdmission(queryClient, current, update, recoveredProviderChange)
      }
    }

    state.activeEpoch = current.serverVersion.epoch

    const admitted = shouldAdmit(current, update.snapshot)
    let acknowledgedIntent: ActiveSettingsIntent | null = null
    let newlyAcknowledgedIntent: ActiveSettingsIntent | null = null
    host.batch(() => {
      if (admitted) {
        state.lastConfirmed = update.snapshot
        queryClient.setQueryData(settingsKeys.document(), update.snapshot)
      }
      if (update.originMutationId) {
        const acknowledgement = acknowledgeIntent(queryClient, update.originMutationId)
        acknowledgedIntent = acknowledgement.intent
        newlyAcknowledgedIntent = acknowledgement.newlyAcknowledged
      }
    })

    invalidateProviderQueries(
      queryClient,
      recoveredProviderChange ||
        providerInvalidationRequired(admitted, update, newlyAcknowledgedIntent),
    )

    return {
      acknowledgedIntent,
      admitted,
      recoveryPending: false,
      snapshot: confirmedSnapshot(queryClient) ?? state.lastConfirmed,
    }
  }

  async function recoverUnexpectedEpoch(queryClient: QueryClient) {
    const state = admissionState(queryClient)
    return queryClient.query({
      queryKey: settingsKeys.recovery(state.recoveryLifetime),
      queryFn: ({ signal }) => refreshConfirmedSettingsWithEvidence(queryClient, signal),
      staleTime: 0,
      gcTime: 0,
      retry: false,
    })
  }

  function shouldAdmit(current: SettingsSnapshot | undefined, incoming: SettingsSnapshot): boolean {
    if (!current) return true
    if (current.serverVersion.epoch !== incoming.serverVersion.epoch) return false

    return incoming.serverVersion.sequence > current.serverVersion.sequence
  }

  function retiredAdmission(queryClient: QueryClient): AdmissionResult {
    const state = admissionState(queryClient)
    return {
      acknowledgedIntent: null,
      admitted: false,
      recoveryPending: false,
      snapshot: confirmedSnapshot(queryClient) ?? state.lastConfirmed,
    }
  }

  function confirmedEvidenceAdmission(
    queryClient: QueryClient,
    confirmed: SettingsSnapshot,
    update: SettingsUpdate,
    recoveredProviderChange: boolean,
  ): AdmissionResult {
    const intent = intentSatisfiedBySnapshot(queryClient, update.originMutationId, confirmed)
    const acknowledgement = acknowledgeIntent(queryClient, intent?.intentId)
    invalidateProviderQueries(
      queryClient,
      recoveredProviderChange ||
        providerInvalidationRequired(false, undefined, acknowledgement.newlyAcknowledged),
    )

    return {
      acknowledgedIntent: acknowledgement.intent,
      admitted: false,
      recoveryPending: false,
      snapshot: confirmed,
    }
  }

  function intentSatisfiedBySnapshot(
    queryClient: QueryClient,
    mutationId: string | undefined,
    snapshot: SettingsSnapshot,
  ): ActiveSettingsIntent | null {
    if (!mutationId) return null

    const intent = settingsIntentStore
      .getState()
      .active.find((entry) => entry.patch.owner === queryClient && entry.intentId === mutationId)
    if (!intent) return null

    const layer = snapshot.layers.find((candidate) => candidate.id === intent.patch.request.target)
    if (!layer) return null

    const reduction = applySettingsOperations(layer.raw, intent.patch.request.operations)
    return reduction.raw === layer.raw ? intent : null
  }

  function acknowledgeIntent(queryClient: QueryClient, mutationId: string | undefined) {
    if (!mutationId) return { intent: null, newlyAcknowledged: null }
    const owned = settingsIntentStore
      .getState()
      .active.some((entry) => entry.patch.owner === queryClient && entry.intentId === mutationId)
    if (!owned) return { intent: null, newlyAcknowledged: null }

    const wasPending = settingsIntentStatus(mutationId) === 'pending'
    const intent = acknowledgeSettingsIntent(mutationId)
    return { intent, newlyAcknowledged: wasPending ? intent : null }
  }

  function deferredAdmission(
    queryClient: QueryClient,
    state: AdmissionState,
    update: SettingsUpdate,
    existing?: DeferredSettingsUpdate,
  ): AdmissionResult {
    if (state.disposed) return inactiveAdmission()
    const deferred = existing ?? createDeferredUpdate(update)
    if (!state.deferred.includes(deferred)) state.deferred.push(deferred)

    return {
      acknowledgedIntent: null,
      admitted: false,
      confirmation: deferred.confirmation,
      recoveryPending: true,
      snapshot: confirmedSnapshot(queryClient) ?? state.lastConfirmed,
    }
  }

  function createDeferredUpdate(update: SettingsUpdate): DeferredSettingsUpdate {
    let resolve: (result: AdmissionResult) => void = () => undefined
    const confirmation = new Promise<AdmissionResult>((settle) => {
      resolve = settle
    })

    return { confirmation, resolve, update }
  }

  function scheduleDeferredAdmissions(queryClient: QueryClient, state: AdmissionState) {
    if (state.deferredScheduled || state.deferred.length === 0 || state.disposed) return

    state.deferredScheduled = true
    globalThis.setTimeout(() => {
      state.deferredScheduled = false
      if (state.disposed) return

      void drainDeferredAdmissions(queryClient, state)
    }, 0)
  }

  async function drainDeferredAdmissions(queryClient: QueryClient, state: AdmissionState) {
    const deferred = state.deferred.splice(0)
    for (const entry of deferred) {
      const result = await admitSettingsUpdate(queryClient, entry.update, entry)
      if (!result.recoveryPending) entry.resolve(result)
    }
  }

  function providerInvalidationRequired(
    admitted: boolean,
    update: SettingsUpdate | undefined,
    acknowledgedIntent: ActiveSettingsIntent | null,
  ) {
    if (
      acknowledgedIntent?.patch.request.operations.some(
        (operation) => operation.kind === 'provider.setEnabled',
      )
    ) {
      return true
    }

    return admitted && Boolean(update?.changedSettingIds.includes('providers.instances'))
  }

  function claimProviderChange(state: AdmissionState, refreshed: ConfirmedSettingsRefresh) {
    const generation = refreshed.providerChangeGeneration
    if (generation === null) return false
    if (generation <= state.latestInvalidatedProviderReadGeneration) return false

    state.latestInvalidatedProviderReadGeneration = generation
    return true
  }

  function invalidateProviderQueries(queryClient: QueryClient, required: boolean) {
    if (!required) return

    host.invalidateProviders(queryClient)
  }

  function confirmedSnapshot(queryClient: QueryClient) {
    return queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())
  }

  function providersChanged(previous: SettingsSnapshot, accepted: SettingsSnapshot) {
    return (
      JSON.stringify(previous.values['providers.instances']) !==
      JSON.stringify(accepted.values['providers.instances'])
    )
  }

  function admissionState(queryClient: QueryClient): AdmissionState {
    const known = stateByClient.get(queryClient)
    if (known) return known

    const state: AdmissionState = {
      activeEpoch: confirmedSnapshot(queryClient)?.serverVersion.epoch ?? null,
      deferred: [],
      deferredScheduled: false,
      disposed: false,
      lastConfirmed: confirmedSnapshot(queryClient),
      latestCompletedReadGeneration: 0,
      latestInvalidatedProviderReadGeneration: 0,
      nextReadGeneration: 0,
      recoveryLifetime: globalThis.crypto.randomUUID(),
      retiredEpochs: new Set(),
    }
    stateByClient.set(queryClient, state)
    return state
  }

  function retireActiveEpoch(state: AdmissionState) {
    if (state.activeEpoch) state.retiredEpochs.add(state.activeEpoch)
  }

  return {
    beginSettingsSnapshotRead,
    observeInitialSettingsSnapshot,
    admitSettingsMutationResult,
    admitSettingsEvent,
    admitSettingsRawResult,
    refreshConfirmedSettings,
    resetSettingsSnapshotAdmission,
  }
}
