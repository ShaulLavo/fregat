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

type LiveScroll = {
  readonly element: HTMLElement
  readonly query: string | null
  readonly geometry: readonly SearchScrollRow[] | undefined
  height: number
  top: number
  moved: boolean
}

export class SearchResultScrollState {
  private query: string | null = null
  private anchor: { id: string; fraction: number } | null = null
  public onRemember: (() => void) | undefined
  private viewport: SearchResultVirtualListViewport = { height: 0, top: 0 }
  private live: LiveScroll | null = null

  snapshot() {
    this.settle()
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
    const row = this.anchor ? geometry?.find((value) => value.key === this.anchor?.id) : undefined
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
    this.record(query, viewport, geometry)
    this.onRemember?.()
  }

  follow(live: LiveScroll) {
    this.live = live
    this.record(live.query, { height: live.height, top: live.top }, live.geometry)
    this.onRemember?.()
  }

  /** Keep the offset before DOM removal; defer anchor lookup until settlement. */
  moved() {
    if (!this.live) return
    this.live.top = this.live.element.scrollTop
    this.live.moved = true
    this.onRemember?.()
  }

  /** A detached element reads as zero; settle its last observed offset instead. */
  release(live: LiveScroll) {
    if (this.live !== live) return
    if (live.element.isConnected) {
      live.height = live.element.clientHeight || live.height
      live.top = live.element.scrollTop
      live.moved = true
    }
    this.settle()
    this.live = null
  }

  settle() {
    const live = this.live
    if (!live?.moved) return
    live.moved = false
    this.record(live.query, { height: live.height, top: live.top }, live.geometry)
  }

  private record(
    query: string | null,
    viewport: SearchResultVirtualListViewport,
    geometry: readonly SearchScrollRow[] | undefined,
  ) {
    if (query !== this.query) this.anchor = null
    this.query = query
    this.viewport = viewport
    const row = geometry ? searchScrollRowAt(geometry, viewport.top) : undefined
    if (row) this.anchor = { id: row.key, fraction: (viewport.top - row.start) / row.size }
  }
}

/** The row covering `offset`; rows are sorted by `start`. */
export function searchScrollRowAt(rows: readonly SearchScrollRow[], offset: number) {
  let low = 0
  let high = rows.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const row = rows[middle]
    if (!row) return undefined
    if (offset < row.start) {
      high = middle - 1
      continue
    }
    if (offset < row.start + row.size) return row
    low = middle + 1
  }

  return undefined
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
  const live = {
    element,
    query,
    geometry,
    height: element.clientHeight || viewport.height,
    top: element.scrollTop,
    moved: false,
  }
  state.follow(live)
  const moved = () => state.moved()
  const settle = () => state.settle()
  element.addEventListener('scroll', moved, { passive: true })
  element.addEventListener('scrollend', settle, { passive: true })

  return () => {
    element.removeEventListener('scroll', moved)
    element.removeEventListener('scrollend', settle)
    state.release(live)
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
