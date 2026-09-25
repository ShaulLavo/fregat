import {
  combineDiagnosticsFreshness,
  summarizeDiagnostics,
} from '@singapore-editor/lsp-plugin/diagnostics'
import {
  type LanguageServerDiagnosticSummary,
  type LanguageServerStatus,
} from '@singapore-editor/lsp-plugin/websocket'

export type EditorLanguageServerStatusSnapshot = {
  diagnostics: LanguageServerDiagnosticSummary | null
  /** Servers that failed while another answers: `status` is `ready` as soon as any one is. */
  failedServerIds: readonly string[]
  /** Servers still connecting, whose answer the aggregate does not include yet. */
  pendingServerIds: readonly string[]
  status: LanguageServerStatus
}

export type EditorLanguageServerStatusSource = {
  getSnapshot: () => EditorLanguageServerStatusSnapshot
  getServerStates: () => ReadonlyMap<string, LanguageServerState>
  /** Adopts the states of servers this source also lists; its other servers keep their own. */
  setServerStates: (states: ReadonlyMap<string, LanguageServerState>) => void
  setServers: (serverIds: readonly string[]) => void
  setServerDiagnostics: (serverId: string, diagnostics: LanguageServerDiagnosticSummary) => void
  setServerInteractiveReady: (serverId: string) => void
  setServerStatus: (serverId: string, status: LanguageServerStatus) => void
  subscribe: (listener: () => void) => () => void
}

type LanguageServerState = {
  connected: boolean
  diagnostics: LanguageServerDiagnosticSummary | null
  status: LanguageServerStatus
  usable: boolean
}

const idleLanguageServerStatusSnapshot: EditorLanguageServerStatusSnapshot = {
  diagnostics: null,
  failedServerIds: [],
  pendingServerIds: [],
  status: 'idle',
}

export function createEditorLanguageServerStatusSource(): EditorLanguageServerStatusSource {
  let snapshot = idleLanguageServerStatusSnapshot
  let serverIds: readonly string[] = []
  const servers = new Map<string, LanguageServerState>()
  const listeners = new Set<() => void>()

  function publish() {
    const next = aggregateSnapshot(serverIds, servers)
    if (languageServerStatusSnapshotsEqual(snapshot, next)) return

    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    getServerStates: () => servers,
    setServerStates: (states) => {
      for (const [serverId, state] of states) {
        if (servers.has(serverId)) servers.set(serverId, state)
      }
      publish()
    },
    setServers: (nextServerIds) => {
      serverIds = nextServerIds
      servers.clear()
      for (const serverId of nextServerIds) servers.set(serverId, initialServerState())
      publish()
    },
    setServerDiagnostics: (serverId, diagnostics) => {
      const state = servers.get(serverId)
      if (!state) return

      servers.set(serverId, { ...state, diagnostics, usable: true })
      publish()
    },
    setServerInteractiveReady: (serverId) => {
      const state = servers.get(serverId)
      if (!state || state.usable) return

      servers.set(serverId, { ...state, usable: true })
      publish()
    },
    setServerStatus: (serverId, status) => {
      const state = servers.get(serverId)
      if (!state) return

      servers.set(serverId, statusState(state, status))
      publish()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function initialServerState(): LanguageServerState {
  return {
    connected: false,
    diagnostics: null,
    status: 'loading',
    usable: false,
  }
}

function statusState(
  current: LanguageServerState,
  status: LanguageServerStatus,
): LanguageServerState {
  if (status === 'ready') return { ...current, connected: true, status }
  if (status === 'loading') return { ...current, connected: false, status, usable: false }
  if (status === 'error') {
    return { ...current, connected: false, diagnostics: null, status, usable: false }
  }
  return { ...current, connected: false, diagnostics: null, status, usable: false }
}

function aggregateSnapshot(
  serverIds: readonly string[],
  servers: ReadonlyMap<string, LanguageServerState>,
): EditorLanguageServerStatusSnapshot {
  if (serverIds.length === 0) return idleLanguageServerStatusSnapshot

  const states = serverIds.flatMap((serverId) => {
    const state = servers.get(serverId)
    return state ? [state] : []
  })
  const aggregate = {
    diagnostics: aggregateDiagnostics(states),
    failedServerIds: serverIds.filter((serverId) => servers.get(serverId)?.status === 'error'),
    pendingServerIds: serverIds.filter((serverId) => servers.get(serverId)?.status === 'loading'),
  }
  if (states.some((state) => state.connected && state.usable)) {
    return { ...aggregate, status: 'ready' }
  }
  if (states.every((state) => state.status === 'error')) return { ...aggregate, status: 'error' }

  return { ...aggregate, status: 'loading' }
}

function aggregateDiagnostics(
  states: readonly LanguageServerState[],
): LanguageServerDiagnosticSummary | null {
  const summaries = states.flatMap((state) => (state.diagnostics ? [state.diagnostics] : []))
  if (summaries.length === 0) return null

  const metadata = summaries.find((summary) => summary.diagnostics.length > 0) ?? summaries[0]
  return summarizeDiagnostics(
    metadata?.uri ?? null,
    metadata?.version ?? null,
    summaries.flatMap((summary) => summary.diagnostics),
    combineDiagnosticsFreshness(summaries.map((summary) => summary.freshness)),
  )
}

function languageServerStatusSnapshotsEqual(
  current: EditorLanguageServerStatusSnapshot,
  next: EditorLanguageServerStatusSnapshot,
) {
  return (
    current.diagnostics === next.diagnostics &&
    current.status === next.status &&
    sameIds(current.failedServerIds, next.failedServerIds) &&
    sameIds(current.pendingServerIds, next.pendingServerIds)
  )
}

function sameIds(current: readonly string[], next: readonly string[]) {
  return current.length === next.length && current.every((id, index) => id === next[index])
}
