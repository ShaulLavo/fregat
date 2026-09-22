import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import {
  type LanguageServerDiagnosticSummary,
  type LanguageServerStatus,
} from '@singapore-editor/lsp-plugin/websocket'

export type EditorLanguageServerStatusSnapshot = {
  diagnostics: LanguageServerDiagnosticSummary | null
  status: LanguageServerStatus
}

export type EditorLanguageServerStatusSource = {
  setSnapshot: (snapshot: EditorLanguageServerStatusSnapshot) => void
  getSnapshot: () => EditorLanguageServerStatusSnapshot
  setServers: (serverIds: readonly string[]) => void
  setServerDiagnostics: (serverId: string, diagnostics: LanguageServerDiagnosticSummary) => void
  setServerInteractiveReady: (serverId: string) => void
  setServerStatus: (serverId: string, status: LanguageServerStatus) => void
  subscribe: (listener: () => void) => () => void
}

type ServerState = {
  connected: boolean
  diagnostics: LanguageServerDiagnosticSummary | null
  status: LanguageServerStatus
  usable: boolean
}

const idleLanguageServerStatusSnapshot: EditorLanguageServerStatusSnapshot = {
  diagnostics: null,
  status: 'idle',
}

export function createEditorLanguageServerStatusSource(): EditorLanguageServerStatusSource {
  let snapshot = idleLanguageServerStatusSnapshot
  let serverIds: readonly string[] = []
  const servers = new Map<string, ServerState>()
  const listeners = new Set<() => void>()

  function publish() {
    const next = aggregateSnapshot(serverIds, servers)
    if (languageServerStatusSnapshotsEqual(snapshot, next)) return

    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      if (snapshot === next) return
      snapshot = next
      for (const listener of listeners) listener()
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

function initialServerState(): ServerState {
  return {
    connected: false,
    diagnostics: null,
    status: 'loading',
    usable: false,
  }
}

function statusState(current: ServerState, status: LanguageServerStatus): ServerState {
  if (status === 'ready') return { ...current, connected: true, status }
  if (status === 'loading') return { ...current, connected: false, status, usable: false }
  if (status === 'error') {
    return { ...current, connected: false, diagnostics: null, status, usable: false }
  }
  return { ...current, connected: false, diagnostics: null, status, usable: false }
}

function aggregateSnapshot(
  serverIds: readonly string[],
  servers: ReadonlyMap<string, ServerState>,
): EditorLanguageServerStatusSnapshot {
  if (serverIds.length === 0) return idleLanguageServerStatusSnapshot

  const states = serverIds.flatMap((serverId) => {
    const state = servers.get(serverId)
    return state ? [state] : []
  })
  const diagnostics = aggregateDiagnostics(states)
  if (states.some((state) => state.connected && state.usable)) {
    return { diagnostics, status: 'ready' }
  }
  if (states.every((state) => state.status === 'error')) return { diagnostics, status: 'error' }

  return { diagnostics, status: 'loading' }
}

function aggregateDiagnostics(
  states: readonly ServerState[],
): LanguageServerDiagnosticSummary | null {
  const summaries = states.flatMap((state) => (state.diagnostics ? [state.diagnostics] : []))
  if (summaries.length === 0) return null

  const metadata = summaries.find((summary) => summary.diagnostics.length > 0) ?? summaries[0]
  return summarizeDiagnostics(
    metadata?.uri ?? null,
    metadata?.version ?? null,
    summaries.flatMap((summary) => summary.diagnostics),
  )
}

function languageServerStatusSnapshotsEqual(
  current: EditorLanguageServerStatusSnapshot,
  next: EditorLanguageServerStatusSnapshot,
) {
  return current.diagnostics === next.diagnostics && current.status === next.status
}
