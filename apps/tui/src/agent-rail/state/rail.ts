import type { SessionSeenStamps } from '@workspace/client-core/chat/rail/unread'
import * as v from 'valibot'
import {
  commandIdSchema,
  projectIdSchema,
  projectRegistrationResultSchema,
  orchestrationSearchSessionsResultSchema,
  ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH,
  ORCHESTRATION_SESSION_SEARCH_MAX_QUERY_LENGTH,
  scopedSessionKey,
  type ClientOrchestrationCommand,
  type ProjectId,
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

type State = {
  readonly query: string
  readonly view: SessionRailView
  readonly scope: ProjectId | null
  readonly collapsed: readonly ProjectId[]
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
  const listeners = new Set<() => void>()
  let request = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const collapsed = ready.storage.getItem('agent:rail:collapsed')
  const seen = ready.storage.getItem('agent:rail:seen')
  let state: State = {
    query: '',
    view: 'active',
    scope: null,
    marked: [],
    anchor: null,
    search: {},
    searching: false,
    collapsed: collapsed ? v.parse(v.array(projectIdSchema), JSON.parse(collapsed)) : [],
    seen: seen ? v.parse(v.record(v.string(), v.string()), JSON.parse(seen)) : {},
    busy: false,
    error: null,
  }
  function publish(patch: Partial<State>) {
    if (lifetime.signal.aborted) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
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
    if (state.busy || lifetime.signal.aborted) return null
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
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setQuery,
    setScope: (scope: ProjectId | null) => publish({ scope, marked: [], anchor: null }),
    toggleArchived: () =>
      publish({ view: state.view === 'active' ? 'archived' : 'active', marked: [], anchor: null }),
    toggleCollapsed(projectId: ProjectId) {
      const collapsed = state.collapsed.includes(projectId)
        ? state.collapsed.filter((id) => id !== projectId)
        : [...state.collapsed, projectId]
      ready.storage.setItem('agent:rail:collapsed', JSON.stringify(collapsed))
      publish({ collapsed })
    },
    mark: (id: SessionId) => publish({ marked: toggledSessionIds(state.marked, id), anchor: id }),
    markRange: (ids: readonly SessionId[], id: SessionId) =>
      publish({ marked: sessionIdRange(ids, state.anchor, id), anchor: state.anchor ?? id }),
    markAll: (marked: readonly SessionId[]) => publish({ marked }),
    clearMarks: () => publish({ marked: [], anchor: null }),
    markSeen(id: SessionId, stamp: string | null) {
      if (!stamp) return
      const key = scopedSessionKey({ environmentId: ready.descriptor.environmentId, sessionId: id })
      if (state.seen[key] === stamp) return
      const seen = { ...state.seen, [key]: stamp }
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
              publish({ marked: state.marked.filter((id) => id !== command.sessionId) })
          }
          return true
        })) === true
      )
    },
    addProject(workspaceRoot: string) {
      return run(async () => {
        const paths = await readServerPaths({ client: session.client, signal: lifetime.signal })
        const absolute = absolutePickerPath(workspaceRoot, paths.workspaceRoot)
        const result = await ready.chat.dispatch({
          type: 'project.create',
          commandId: v.parse(commandIdSchema, crypto.randomUUID()),
          workspaceRoot: absolute,
          title: absolute.split('/').filter(Boolean).at(-1) ?? 'Root',
          defaultModelSelection: null,
        })
        return v.parse(projectRegistrationResultSchema, result.result)
      })
    },
    dispose() {
      lifetime.abort()
      request.abort()
      if (timer) clearTimeout(timer)
      listeners.clear()
    },
  }
}
