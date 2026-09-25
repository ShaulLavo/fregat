import { QueryObserver, type QueryClient } from '@tanstack/query-core'
import type {
  EnvironmentId,
  OrchestrationSessionDetailPage,
  OrchestrationWsSessionDetailPageInput,
  SessionId,
} from '@workspace/contracts'
import { chatSessionEarlierPageInput, selectChatSessionHasEarlier } from './selectors'
import type { ChatProjectionSlice } from './types'

export type EarlierPageObserver = QueryObserver<OrchestrationSessionDetailPage>

type PageIdentity = {
  readonly environmentId: EnvironmentId
  readonly lifetime: string
  readonly generation: number
  readonly historySequence: number
  readonly input: OrchestrationWsSessionDetailPageInput
}

type EarlierPageHost = {
  readonly environmentId: EnvironmentId
  readonly queryClient: QueryClient
  readonly projection: () => ChatProjectionSlice
  readonly read: (
    input: OrchestrationWsSessionDetailPageInput,
  ) => Promise<OrchestrationSessionDetailPage>
  readonly prepend: (page: OrchestrationSessionDetailPage) => void
  readonly onError?: (error: unknown, sessionId: SessionId) => void
}

export function earlierPageQueryOptions(identity: PageIdentity, read: EarlierPageHost['read']) {
  return {
    queryKey: [
      'chat',
      'earlier-page',
      identity.environmentId,
      identity.lifetime,
      identity.input.sessionId,
      identity.generation,
      identity.historySequence,
      identity.input,
    ] as const,
    queryFn: () => read(identity.input),
    meta: { generation: identity.generation, historySequence: identity.historySequence },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  }
}

export function createSessionEarlierPages(host: EarlierPageHost) {
  const lifetime = globalThis.crypto.randomUUID()
  const prefix = ['chat', 'earlier-page', host.environmentId, lifetime] as const
  const observers = new Map<SessionId | null, EarlierPageObserver>()
  let generation = 0
  let disposed = false

  function idleOptions(sessionId: SessionId | null) {
    return { queryKey: [...prefix, sessionId, generation, 'idle'], enabled: false, gcTime: 0 }
  }

  function observer(sessionId: SessionId | null) {
    const existing = observers.get(sessionId)
    if (existing) return existing
    const created = new QueryObserver<OrchestrationSessionDetailPage>(
      host.queryClient,
      idleOptions(sessionId),
    )
    // The transport owns this observer even when its timeline is parked.
    created.subscribe(() => {})
    observers.set(sessionId, created)
    return created
  }

  function current(identity: PageIdentity) {
    if (disposed || generation !== identity.generation) return false
    return (
      (host.projection().sessionHistorySequenceById[identity.input.sessionId] ?? 0) ===
      identity.historySequence
    )
  }

  async function acquire(identity: PageIdentity) {
    try {
      const page = await host.read(identity.input)
      if (current(identity)) host.prepend(page)
      return page
    } catch (error) {
      if (current(identity)) host.onError?.(error, identity.input.sessionId)
      throw error
    }
  }

  async function load(sessionId: SessionId) {
    const projection = host.projection()
    if (disposed || !selectChatSessionHasEarlier(projection, sessionId)) return false
    const active = observer(sessionId)
    const identity: PageIdentity = {
      environmentId: host.environmentId,
      lifetime,
      generation,
      historySequence: projection.sessionHistorySequenceById[sessionId] ?? 0,
      input: chatSessionEarlierPageInput(projection, sessionId),
    }
    const pending =
      active.getCurrentResult().isFetching &&
      active.options.meta?.generation === generation &&
      active.options.meta?.historySequence === identity.historySequence
    const options = pending
      ? active.options
      : earlierPageQueryOptions(identity, () => acquire(identity))
    if (!pending) active.setOptions({ ...options, enabled: false })
    try {
      await host.queryClient.query(options)
      return current(identity)
    } catch {
      return false
    }
  }

  function reset() {
    generation += 1
    host.queryClient.removeQueries({ queryKey: prefix })
    for (const [sessionId, active] of observers) active.setOptions(idleOptions(sessionId))
  }

  return {
    observer,
    load,
    reset,
    dispose() {
      if (disposed) return
      disposed = true
      reset()
      for (const active of observers.values()) active.destroy()
      host.queryClient.removeQueries({ queryKey: prefix })
    },
  }
}

export type SessionEarlierPages = ReturnType<typeof createSessionEarlierPages>
