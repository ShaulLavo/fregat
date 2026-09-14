import type { Client } from '@/lib/client'
import type {
  WorkspaceSearchEvent,
  WorkspaceSearchMatch,
  WorkspaceSearchQuery,
} from '@workspace/contracts'

import {
  type SearchBufferStoreApi,
  type SearchBufferSnapshot,
  sameWorkspaceSearchQuery,
} from '@/features/search/state/buffer-state'
import { errorMessage } from '@/lib/error-message'
import {
  CompositeSearchProvider,
  DiskSearchProvider,
  OpenBufferSearchProvider,
  type OpenBufferSearchDocument,
  type SearchProvider,
} from '@/features/search/utils/providers'

const SEARCH_FIRST_BATCH_DELAY_MS = 0
const SEARCH_STEADY_BATCH_DELAY_MS = 48
const SEARCH_FRAME_FALLBACK_MS = 16

type SearchRunOptions = {
  deferInitialOpenBufferMatches?: boolean
}

export async function runSearch(
  provider: SearchProvider,
  query: WorkspaceSearchQuery,
  runId: number,
  store: SearchBufferStoreApi,
  signal: AbortSignal,
  options: SearchRunOptions = {},
) {
  const batcher = createFirstPaintSearchEventBatcher(
    createSearchEventBatcher(runId, store),
    options.deferInitialOpenBufferMatches === true,
  )

  try {
    for await (const event of provider.search(query, signal)) {
      if (signal.aborted) return
      if (event.type === 'match') {
        batcher.push(event)
        continue
      }

      if (event.type === 'error') {
        batcher.fail()
        store.getState().appendEvent(runId, event)
        continue
      }

      batcher.push(event)
      batcher.flush()
    }
  } catch (error) {
    if (isAbortError(error)) return

    batcher.fail()
    store.getState().failSearch(runId, errorMessage(error, 'Search failed.'))
  } finally {
    batcher.dispose()
  }
}

type SearchEventBatcher = {
  dispose(): void
  flush(): void
  push(event: WorkspaceSearchEvent): void
  pushMany(events: readonly WorkspaceSearchEvent[]): void
}

export function createFirstPaintSearchEventBatcher(
  batcher: SearchEventBatcher,
  deferInitialOpenBufferMatches: boolean,
) {
  let buffered: WorkspaceSearchEvent[] = []
  let open = !deferInitialOpenBufferMatches

  function releaseBuffered(event?: WorkspaceSearchEvent) {
    if (open) {
      if (event) batcher.push(event)
      return
    }

    open = true
    const events = event ? buffered.concat(event) : buffered
    buffered = []
    if (events.length === 0) return

    batcher.pushMany(events)
  }

  return {
    dispose() {
      buffered = []
      batcher.dispose()
    },
    fail() {
      if (open) batcher.flush()
      buffered = []
      open = true
    },
    flush() {
      releaseBuffered()
      batcher.flush()
    },
    push(event: WorkspaceSearchEvent) {
      if (open) {
        batcher.push(event)
        return
      }

      if (isOpenBufferMatchEvent(event)) {
        buffered.push(event)
        return
      }

      releaseBuffered(event)
      batcher.flush()
    },
  }
}

function isOpenBufferMatchEvent(event: WorkspaceSearchEvent) {
  return event.type === 'match' && event.match.source === 'open-buffer'
}

function createSearchEventBatcher(runId: number, store: SearchBufferStoreApi): SearchEventBatcher {
  let pending: WorkspaceSearchEvent[] = []
  let delayTimer: ReturnType<typeof setTimeout> | null = null
  let cancelFrame: (() => void) | null = null
  let flushedOnce = false
  let disposed = false

  function clearDelayTimer() {
    if (delayTimer === null) return

    globalThis.clearTimeout(delayTimer)
    delayTimer = null
  }

  function clearFrame() {
    if (!cancelFrame) return

    cancelFrame()
    cancelFrame = null
  }

  function clearScheduledFlush() {
    clearDelayTimer()
    clearFrame()
  }

  function flush() {
    if (pending.length === 0) return

    const events = pending
    pending = []
    flushedOnce = true
    clearScheduledFlush()
    store.getState().appendEvents(runId, events)
  }

  function scheduleFrameFlush() {
    if (disposed) return
    if (cancelFrame) return

    cancelFrame = scheduleSearchBatchFrame(() => {
      cancelFrame = null
      flush()
    })
  }

  function scheduleFlush() {
    if (disposed) return
    if (cancelFrame || delayTimer !== null) return

    const delay = flushedOnce ? SEARCH_STEADY_BATCH_DELAY_MS : SEARCH_FIRST_BATCH_DELAY_MS
    if (delay === 0) {
      scheduleFrameFlush()
      return
    }

    delayTimer = globalThis.setTimeout(() => {
      delayTimer = null
      scheduleFrameFlush()
    }, delay)
  }

  function pushMany(events: readonly WorkspaceSearchEvent[]) {
    pending.push(...events)
    scheduleFlush()
  }

  function dispose() {
    disposed = true
    pending = []
    clearScheduledFlush()
  }

  return {
    dispose,
    flush,
    push(event: WorkspaceSearchEvent) {
      pushMany([event])
    },
    pushMany,
  }
}

function scheduleSearchBatchFrame(callback: () => void) {
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    const frame = window.requestAnimationFrame(callback)
    return () => window.cancelAnimationFrame(frame)
  }

  const timer = globalThis.setTimeout(callback, SEARCH_FRAME_FALLBACK_MS)
  return () => globalThis.clearTimeout(timer)
}

export function shouldDeferInitialOpenBufferMatches(
  snapshot: SearchBufferSnapshot | null,
  query: WorkspaceSearchQuery,
) {
  if (!snapshot) return false
  if (snapshot.rootPath !== query.path) return false
  if (snapshot.matches.length === 0) return false

  return !sameWorkspaceSearchQuery(snapshot.resultsSearchQuery, query)
}

export function workspaceSearchProvider(
  documents: readonly OpenBufferSearchDocument[],
  client: Client,
) {
  return new CompositeSearchProvider({
    disk: new DiskSearchProvider(client),
    openBufferPaths: new Set(documents.map((document) => document.path)),
    openBuffers: new OpenBufferSearchProvider(documents),
  })
}

export function clientOnlyWorkspaceSearchProvider(
  snapshot: SearchBufferSnapshot | null,
  documents: readonly OpenBufferSearchDocument[],
  query: WorkspaceSearchQuery,
): SearchProvider | null {
  if (!snapshot) return null
  if (snapshot.status !== 'ready') return null
  if (!sameWorkspaceSearchQuery(snapshot.resultsSearchQuery, query)) return null
  if (documents.length === 0 && !hasOpenBufferMatch(snapshot.matches)) return null

  return new ClientOnlyWorkspaceSearchProvider(snapshot.matches, documents)
}

function hasOpenBufferMatch(matches: readonly WorkspaceSearchMatch[]) {
  return matches.some((match) => match.source === 'open-buffer')
}

// A buffer that was overlaid and then saved keeps its overlay matches: they are
// what was written to disk. Re-running ripgrep for it would replace every
// truncated result set with a different one, which read as the search changing
// on every save. Only the `unsaved` provenance is dropped.
function settledMatch(match: WorkspaceSearchMatch): WorkspaceSearchMatch {
  if (match.source !== 'open-buffer') return match

  return { ...match, source: 'disk' }
}

class ClientOnlyWorkspaceSearchProvider implements SearchProvider {
  private baseMatches: readonly WorkspaceSearchMatch[]
  private documents: readonly OpenBufferSearchDocument[]

  constructor(
    baseMatches: readonly WorkspaceSearchMatch[],
    documents: readonly OpenBufferSearchDocument[],
  ) {
    this.baseMatches = baseMatches
    this.documents = documents
  }

  async *search(
    query: WorkspaceSearchQuery,
    signal?: AbortSignal,
  ): AsyncGenerator<WorkspaceSearchEvent> {
    const dirtyPaths = new Set(this.documents.map((document) => document.path))
    const openBuffers = new OpenBufferSearchProvider(this.documents)
    let count = 0
    let truncated = false

    for (const match of this.baseMatches) {
      if (signal?.aborted) return
      if (dirtyPaths.has(match.path)) continue
      if (count >= query.limit) {
        truncated = true
        break
      }

      count += 1
      yield { match: settledMatch(match), type: 'match' }
    }

    if (!truncated) {
      for await (const event of openBuffers.search(query, signal)) {
        if (signal?.aborted) return
        if (event.type === 'done') {
          truncated = truncated || event.truncated
          continue
        }
        if (event.type !== 'match') {
          yield event
          continue
        }
        if (count >= query.limit) {
          truncated = true
          break
        }

        count += 1
        yield event
      }
    }

    yield {
      count,
      path: query.path,
      query: query.query,
      truncated,
      type: 'done',
    }
  }
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  if (!('name' in error)) return false

  return error.name === 'AbortError'
}
