import {
  ORCHESTRATION_WS_PROTOCOL_VERSION,
  type HealthDescriptor,
  type OrchestrationWsServerConfig,
} from '@workspace/contracts'
import { createStore } from 'zustand/vanilla'

import { canonicalServerOrigin } from '../../transport/client'
import {
  connectionAfterHandshake,
  connectionAfterDescriptor,
  createEnvironmentEntry,
  initialServerConnection,
  type EnvironmentEntry,
  type EnvironmentPhase,
  type ServerConnectionState,
} from '../utils/connection'
import {
  createEnvironmentIdentityDriftError,
  createEnvironmentProtocolMismatchError,
} from '../utils/structured-errors'

export type EnvironmentsState = {
  readonly activeOrigin: string
  readonly entries: Readonly<Record<string, EnvironmentEntry>>
  readonly connectionByOrigin: Readonly<Record<string, ServerConnectionState>>
}

type EnvironmentsActions = {
  resetConnections(origin?: string): void
  activate(origin: string): void
  addEnvironment(origin: string): void
  describeMachine(
    origin: string,
    machine: Pick<EnvironmentEntry, 'name' | 'kind' | 'label' | 'localPort'>,
  ): void
  setPhase(origin: string, phase: EnvironmentPhase, error?: string | null): void
  markDisconnected(origin: string): void
  recordHandshake(origin: string, config: OrchestrationWsServerConfig): void
  recordDescriptor(origin: string, descriptor: HealthDescriptor): void
  restoreDescriptor(origin: string, descriptor: HealthDescriptor): boolean
  markSlowRequest(origin: string, requestId: string): void
  clearSlowRequest(origin: string, requestId: string): void
}

export type EnvironmentsStore = EnvironmentsState & EnvironmentsActions

export function createEnvironmentsStore({ primaryOrigin }: { readonly primaryOrigin: string }) {
  primaryOrigin = canonicalServerOrigin(primaryOrigin)
  const slowRequestIdsByOrigin = new Map<string, Set<string>>()

  const store = createStore<EnvironmentsStore>((set, get) => ({
    resetConnections: resetServerConnectionStore,
    activeOrigin: primaryOrigin,
    entries: { [primaryOrigin]: createEnvironmentEntry(primaryOrigin, primaryOrigin) },
    connectionByOrigin: { [primaryOrigin]: initialServerConnection },
    activate(origin) {
      origin = canonicalServerOrigin(origin)
      const state = get()
      set({
        activeOrigin: origin,
        entries: state.entries[origin]
          ? state.entries
          : { ...state.entries, [origin]: createEnvironmentEntry(origin, primaryOrigin) },
        connectionByOrigin: state.connectionByOrigin[origin]
          ? state.connectionByOrigin
          : { ...state.connectionByOrigin, [origin]: initialServerConnection },
      })
    },
    addEnvironment(origin) {
      origin = canonicalServerOrigin(origin)
      const state = get()
      if (state.entries[origin]) return

      set({
        entries: { ...state.entries, [origin]: createEnvironmentEntry(origin, primaryOrigin) },
        connectionByOrigin: { ...state.connectionByOrigin, [origin]: initialServerConnection },
      })
    },
    describeMachine(origin, machine) {
      origin = canonicalServerOrigin(origin)
      get().addEnvironment(origin)
      const entries = get().entries
      set({ entries: { ...entries, [origin]: { ...entries[origin]!, ...machine } } })
    },
    setPhase(origin, phase, error = null) {
      origin = canonicalServerOrigin(origin)
      const entries = get().entries
      const entry = entries[origin]
      if (!entry) return
      const connection = selectServerConnection(get(), origin)
      if (connection.phase === 'identity-drift') phase = 'identity-drift'
      if (connection.phase === 'protocol-mismatch') phase = 'blocked'
      if (entry.phase === phase && entry.lastError === error) return
      set({
        entries: {
          ...entries,
          [origin]: {
            ...entry,
            phase,
            lastError: error,
            lastErrorAt: error ? Date.now() : entry.lastErrorAt,
            connectedAt: phase === 'live' ? (entry.connectedAt ?? Date.now()) : entry.connectedAt,
          },
        },
      })
    },
    markDisconnected(origin) {
      origin = canonicalServerOrigin(origin)
      const state = get()
      const connection = selectServerConnection(state, origin)
      if (connection.phase !== 'connected') return

      set({
        connectionByOrigin: {
          ...state.connectionByOrigin,
          [origin]: { ...connection, phase: 'disconnected' },
        },
      })
    },
    recordHandshake(origin, config) {
      origin = canonicalServerOrigin(origin)
      assertEnvironmentIdentity(origin, config.environmentId)
      assertEnvironmentProtocol(origin, config.protocolVersion)
      const state = get()
      const entry = state.entries[origin] ?? createEnvironmentEntry(origin, primaryOrigin)
      const connection = selectServerConnection(state, origin)
      if (connection.serverInstanceId !== config.serverInstanceId)
        slowRequestIdsByOrigin.delete(origin)

      set({
        entries: { ...state.entries, [origin]: { ...entry, environmentId: config.environmentId } },
        connectionByOrigin: {
          ...state.connectionByOrigin,
          [origin]: connectionAfterHandshake(connection, config),
        },
      })
    },
    restoreDescriptor(origin, descriptor) {
      origin = canonicalServerOrigin(origin)
      const state = get()
      const entry = state.entries[origin] ?? createEnvironmentEntry(origin, primaryOrigin)
      if (entry.environmentId) return entry.environmentId === descriptor.environmentId
      set({
        entries: {
          ...state.entries,
          [origin]: {
            ...entry,
            environmentId: descriptor.environmentId,
            descriptor,
            label: descriptor.label,
            phase: 'offline',
          },
        },
        connectionByOrigin: { ...state.connectionByOrigin, [origin]: initialServerConnection },
      })
      return true
    },
    recordDescriptor(origin, descriptor) {
      origin = canonicalServerOrigin(origin)
      assertEnvironmentIdentity(origin, descriptor.environmentId)
      assertEnvironmentProtocol(origin, descriptor.protocolVersion)
      const state = get()
      const entry = state.entries[origin] ?? createEnvironmentEntry(origin, primaryOrigin)
      set({
        entries: {
          ...state.entries,
          [origin]: {
            ...entry,
            environmentId: descriptor.environmentId,
            label: entry.label ?? descriptor.label,
            descriptor,
          },
        },
        connectionByOrigin: {
          ...state.connectionByOrigin,
          [origin]: connectionAfterDescriptor(selectServerConnection(state, origin)),
        },
      })
    },
    markSlowRequest(origin, requestId) {
      origin = canonicalServerOrigin(origin)
      const ids = slowRequestIdsByOrigin.get(origin) ?? new Set<string>()
      if (ids.has(requestId)) return

      ids.add(requestId)
      slowRequestIdsByOrigin.set(origin, ids)
      updateSlowRequestCount(origin, ids.size)
    },
    clearSlowRequest(origin, requestId) {
      origin = canonicalServerOrigin(origin)
      const ids = slowRequestIdsByOrigin.get(origin)
      if (!ids?.delete(requestId)) return

      updateSlowRequestCount(origin, ids.size)
      if (ids.size === 0) slowRequestIdsByOrigin.delete(origin)
    },
  }))

  function resetServerConnectionStore(origin?: string): void {
    const state = store.getState()
    if (origin !== undefined) {
      origin = canonicalServerOrigin(origin)
      slowRequestIdsByOrigin.delete(origin)
      store.setState({
        connectionByOrigin: { ...state.connectionByOrigin, [origin]: initialServerConnection },
      })
      return
    }

    slowRequestIdsByOrigin.clear()
    store.setState({
      connectionByOrigin: Object.fromEntries(
        Object.keys(state.entries).map((entryOrigin) => [entryOrigin, initialServerConnection]),
      ),
    })
  }

  function assertEnvironmentIdentity(origin: string, received: string): void {
    const state = store.getState()
    const expected = state.entries[origin]?.environmentId
    if (!expected || expected === received) return

    store.setState({
      connectionByOrigin: {
        ...state.connectionByOrigin,
        [origin]: {
          ...selectServerConnection(state, origin),
          phase: 'identity-drift',
          expected,
          received,
        },
      },
    })
    throw createEnvironmentIdentityDriftError(origin, expected, received)
  }

  function assertEnvironmentProtocol(origin: string, received: number): void {
    const expected = ORCHESTRATION_WS_PROTOCOL_VERSION
    if (received === expected) return

    const state = store.getState()
    store.setState({
      connectionByOrigin: {
        ...state.connectionByOrigin,
        [origin]: {
          ...selectServerConnection(state, origin),
          phase: 'protocol-mismatch',
          expected,
          received,
        },
      },
    })
    throw createEnvironmentProtocolMismatchError(origin, expected, received)
  }

  function updateSlowRequestCount(origin: string, slowRequestCount: number): void {
    const state = store.getState()
    store.setState({
      connectionByOrigin: {
        ...state.connectionByOrigin,
        [origin]: { ...selectServerConnection(state, origin), slowRequestCount },
      },
    })
  }

  return store
}

export function selectServerConnection(
  state: EnvironmentsState,
  origin: string,
): ServerConnectionState {
  return state.connectionByOrigin[canonicalServerOrigin(origin)] ?? initialServerConnection
}
