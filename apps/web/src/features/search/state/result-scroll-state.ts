import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import { readReloadCache } from '@/lib/reload-cache'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'

import type { SearchResultVirtualListViewport } from '@/features/search/utils/result-virtual-list'

export type SearchScrollRow = {
  readonly key: string
  readonly start: number
  readonly size: number
}

export class SearchResultScrollState {
  private query: string | null = null
  private anchor: { id: string; fraction: number } | null = null
  public onRemember: (() => void) | undefined
  private viewport: SearchResultVirtualListViewport = { height: 0, top: 0 }

  snapshot() {
    return { query: this.query, viewport: this.viewport, anchor: this.anchor }
  }

  restore(
    query: string | null,
    viewport: SearchResultVirtualListViewport,
    anchor: { id: string; fraction: number } | null,
  ) {
    this.query = query
    this.viewport = viewport
    this.anchor = anchor
  }

  read(
    query: string | null,
    geometry?: readonly SearchScrollRow[],
  ): SearchResultVirtualListViewport {
    const row = geometry?.find((value) => value.key === this.anchor?.id)
    if (this.query === query && row && this.anchor)
      return { ...this.viewport, top: row.start + this.anchor.fraction * row.size }
    if (this.query === query) return this.viewport

    return { height: this.viewport.height, top: 0 }
  }

  remember(
    query: string | null,
    viewport: SearchResultVirtualListViewport,
    geometry?: readonly SearchScrollRow[],
  ): void {
    if (query !== this.query) this.anchor = null
    this.query = query
    this.viewport = viewport
    const row = geometry?.find(
      (value) => value.start <= viewport.top && value.start + value.size > viewport.top,
    )
    if (row) this.anchor = { id: row.key, fraction: (viewport.top - row.start) / row.size }
    this.onRemember?.()
  }
}

const scrollStates = new WeakMap<object, Map<string, SearchResultScrollState>>()

export function searchResultScrollState(
  incarnation: object,
  surface = 'editor',
): SearchResultScrollState {
  let states = scrollStates.get(incarnation)
  if (!states) {
    states = new Map()
    scrollStates.set(incarnation, states)
  }
  const existing = states.get(surface)
  if (existing) return existing
  const state = new SearchResultScrollState()
  states.set(surface, state)
  return state
}

export function attachSearchResultScroll({
  element,
  query,
  scrollToOffset,
  state,
  geometry,
}: {
  readonly element: HTMLElement
  readonly query: string | null
  readonly scrollToOffset: (offset: number) => void
  readonly geometry?: readonly SearchScrollRow[]
  readonly state: SearchResultScrollState
}) {
  const viewport = state.read(query, geometry)
  scrollToOffset(viewport.top)
  let height = element.clientHeight || viewport.height
  const remember = () => {
    state.remember(query, { height, top: element.scrollTop }, geometry)
  }
  remember()
  element.addEventListener('scroll', remember, { passive: true })

  return () => {
    if (element.isConnected) {
      height = element.clientHeight || height
      remember()
    }
    element.removeEventListener('scroll', remember)
  }
}

const viewportSchema = v.object({
  height: v.pipe(v.number(), v.finite(), v.minValue(0)),
  top: v.pipe(v.number(), v.finite(), v.minValue(0)),
})
const recordSchema = v.object({
  root: v.string(),
  surfaces: v.array(
    v.object({
      surface: v.picklist(['compact', 'editor']),
      query: v.nullable(v.string()),
      viewport: viewportSchema,
      anchor: v.nullable(
        v.object({
          id: v.string(),
          fraction: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
        }),
      ),
    }),
  ),
})
const MAX_RELOAD_BYTES = 16_384

export function prepareSearchReload(
  store: SearchBufferStoreApi,
  storage: ScopedStorage,
  namespace = '',
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const registered = new WeakSet<object>()
  let admitted = false
  let disposed = false
  const key = `search.viewport.v1${namespace}`
  const saved = readReloadCache<v.InferOutput<typeof recordSchema>>(
    key,
    recordSchema,
    storage,
    MAX_RELOAD_BYTES,
  )
  function flush() {
    if (timer) clearTimeout(timer)
    timer = undefined
    const snapshot = store.getState().active
    if (!snapshot) return
    const surfaces = (['compact', 'editor'] as const).map((surface) => ({
      surface,
      ...searchResultScrollState(snapshot.incarnation, surface).snapshot(),
    }))
    writeWorkspaceCacheEntry(
      key,
      { root: snapshot.rootPath, surfaces },
      { storage, maxSerializedBytes: MAX_RELOAD_BYTES },
    )
  }
  function register() {
    const snapshot = store.getState().active
    if (!snapshot || registered.has(snapshot.incarnation)) return
    registered.add(snapshot.incarnation)
    for (const surface of ['compact', 'editor'] as const) {
      const state = searchResultScrollState(snapshot.incarnation, surface)
      const cached =
        !admitted && saved?.root === snapshot.rootPath
          ? saved.surfaces.find((entry) => entry.surface === surface)
          : null
      if (cached) state.restore(cached.query, cached.viewport, cached.anchor)
      state.onRemember = () => {
        if (!disposed) timer ??= setTimeout(flush, 300)
      }
    }
    if (saved?.root === snapshot.rootPath) admitted = true
  }
  register()
  const unsubscribe = store.subscribe(register)
  const removeFlush = addLifecycleFlush(flush)
  return () => {
    flush()
    disposed = true
    unsubscribe()
    removeFlush()
  }
}
