import { createObservableStore } from '@/host/state/observable-store'
import {
  createProjectRegistrationCommand,
  projectRegistrationResult,
} from '@workspace/client-core/chat/registration'
import type { SessionSeenStamps } from '@workspace/client-core/chat/rail/unread'
import { recordObservabilityWarning } from '@workspace/observability'
import * as v from 'valibot'
import {
  orchestrationSearchSessionsResultSchema,
  ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH,
  ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH,
  scopedSessionKey,
  type ClientOrchestrationCommand,
  type SessionId,
} from '@workspace/contracts'
import { sessionIdRange, toggledSessionIds } from '@workspace/client-core/chat/rail/multi-select'
import type { SessionSearchMatches, SessionRailView } from '@workspace/client-core/chat/rail/model'
import { readServerPaths } from '@workspace/client-core/files/read'
import { absolutePickerPath } from '@workspace/client-core/files/path-input'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import { normalizeEdenDates } from '@workspace/client-core/transport/normalize-dates'
import { connectionFailure } from '@/connection/utils/failure'
import { createTuiError } from '@/host/utils/structured-errors'
import type { SettingsSession, SessionState } from '@/connection/state/session'
import type { FileStorage } from '@/storage/files'

type State = {
  readonly query: string
  readonly view: SessionRailView
  readonly scope: string | null
  readonly collapsed: readonly string[]
  readonly marked: readonly SessionId[]
  readonly anchor: SessionId | null
  readonly search: SessionSearchMatches
  readonly searching: boolean
  readonly seen: SessionSeenStamps
  readonly busy: boolean
  readonly error: string | null
}

export function createAgentRailState(
  session: SettingsSession,
  ready: Extract<SessionState, { kind: 'ready' }>,
) {
  const lifetime = new AbortController()

  let request = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const store = createObservableStore<State>(
    {
      query: '',
      view: 'active',
      scope: null,
      marked: [],
      anchor: null,
      search: {},
      searching: false,
      collapsed: readCollapsed(ready.storage),
      seen: readSeen(ready.storage),
      busy: false,
      error: null,
    },
    { signal: lifetime.signal },
  )
  const publish = store.patch
  async function search(query: string, signal: AbortSignal) {
    try {
      const response = await session.client.orchestration['session-search'].post(
        { query, limit: 50 },
        { fetch: { signal } },
      )
      const result = v.parse(
        orchestrationSearchSessionsResultSchema,
        normalizeEdenDates(requireEdenData(response)),
      )
      if (signal.aborted) return
      publish({
        searching: false,
        search: Object.fromEntries(
          result.matches.map((match) => [
            scopedSessionKey({
              environmentId: ready.descriptor.environmentId,
              sessionId: match.sessionId,
            }),
            match,
          ]),
        ),
      })
    } catch (error) {
      if (!signal.aborted) publish({ searching: false, error: connectionFailure(error).message })
    }
  }
  function setQuery(query: string) {
    request.abort()
    if (timer) clearTimeout(timer)
    request = new AbortController()
    const trimmed = query.trim()
    const searching =
      trimmed.length >= ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH &&
      trimmed.length <= ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH
    publish({ query, search: {}, searching, error: null, marked: [], anchor: null })
    if (searching)
      timer = setTimeout(() => {
        void search(trimmed, request.signal)
      }, 220)
  }
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    if (store.value.busy || lifetime.signal.aborted) return null
    publish({ busy: true, error: null })
    try {
      const connection = session.getSnapshot()
      if (connection.kind !== 'ready' || connection.connection.kind !== 'live')
        throw createTuiError(
          'The environment is disconnected.',
          'Reconnect before changing projects or sessions.',
        )
      return await action()
    } catch (error) {
      publish({ error: connectionFailure(error).message })
      return null
    } finally {
      publish({ busy: false })
    }
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    setQuery,
    setScope: (scope: string | null) => publish({ scope, marked: [], anchor: null }),
    toggleArchived: () =>
      publish({
        view: store.value.view === 'active' ? 'archived' : 'active',
        marked: [],
        anchor: null,
      }),
    toggleCollapsed(keys: readonly string[]) {
      const allCollapsed = keys.every((key) => store.value.collapsed.includes(key))
      const collapsed = store.value.collapsed.filter((key) => !keys.includes(key))
      if (!allCollapsed) collapsed.push(...new Set(keys))
      ready.storage.setItem('agent:rail:collapsed', JSON.stringify(collapsed))
      publish({ collapsed })
    },
    mark: (id: SessionId) =>
      publish({ marked: toggledSessionIds(store.value.marked, id), anchor: id }),
    markRange: (ids: readonly SessionId[], id: SessionId) =>
      publish({
        marked: sessionIdRange(ids, store.value.anchor, id),
        anchor: store.value.anchor ?? id,
      }),
    markAll: (marked: readonly SessionId[]) => publish({ marked }),
    clearMarks: () => publish({ marked: [], anchor: null }),
    markSeen(id: SessionId, stamp: string | null) {
      if (!stamp) return
      const key = scopedSessionKey({ environmentId: ready.descriptor.environmentId, sessionId: id })
      if (store.value.seen[key] === stamp) return
      const seen = { ...store.value.seen, [key]: stamp }
      ready.storage.setItem('agent:rail:seen', JSON.stringify(seen))
      publish({ seen })
    },
    setError: (error: string) => publish({ error }),
    async execute(commands: readonly ClientOrchestrationCommand[], clearCompletedMarks = false) {
      return (
        (await run(async () => {
          for (const command of commands) {
            await ready.chat.dispatch(command)
            if (clearCompletedMarks && 'sessionId' in command)
              publish({ marked: store.value.marked.filter((id) => id !== command.sessionId) })
          }
          return true
        })) === true
      )
    },
    addProject(workspaceRoot: string) {
      return run(async () => {
        const paths = await readServerPaths({ client: session.client, signal: lifetime.signal })
        const absolute = absolutePickerPath(workspaceRoot, paths.workspaceRoot)
        const result = await ready.chat.dispatch(
          createProjectRegistrationCommand({
            workspaceRoot: absolute,
            title: absolute.split('/').filter(Boolean).at(-1) ?? 'Root',
          }),
        )
        return projectRegistrationResult(result)
      })
    },
    dispose() {
      lifetime.abort()
      request.abort()
      if (timer) clearTimeout(timer)
      store.dispose()
    },
  }
}

function readCollapsed(
  storage: Pick<FileStorage, 'getItem' | 'removeItemIfValue'>,
): readonly string[] {
  const key = 'agent:rail:collapsed'
  let raw = storage.getItem(key)
  while (raw !== null) {
    const collapsed = readCollapsedValue(storage, key, raw)
    if (collapsed !== null) return collapsed
    raw = storage.getItem(key)
  }
  return []
}

function readCollapsedValue(
  storage: Pick<FileStorage, 'removeItemIfValue'>,
  key: string,
  raw: string,
) {
  try {
    return v.parse(v.array(v.string()), JSON.parse(raw))
  } catch {
    if (!storage.removeItemIfValue(key, raw)) return null
    recordObservabilityWarning('tui.storage.read', {
      area: 'storage',
      storageKey: key,
      outcome: 'discarded',
    })
    return []
  }
}

function readSeen(storage: Pick<FileStorage, 'getItem' | 'removeItemIfValue'>): SessionSeenStamps {
  const key = 'agent:rail:seen'
  let raw = storage.getItem(key)
  while (raw !== null) {
    const seen = readSeenValue(storage, key, raw)
    if (seen !== null) return seen
    raw = storage.getItem(key)
  }
  return {}
}

function readSeenValue(storage: Pick<FileStorage, 'removeItemIfValue'>, key: string, raw: string) {
  try {
    return v.parse(v.record(v.string(), v.string()), JSON.parse(raw))
  } catch {
    if (!storage.removeItemIfValue(key, raw)) return null
    recordObservabilityWarning('tui.storage.read', {
      area: 'storage',
      storageKey: key,
      outcome: 'discarded',
    })
    return {}
  }
}
