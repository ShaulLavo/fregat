import { readReloadCache } from '@/lib/reload-cache'
import type { QueryClient } from '@tanstack/react-query'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import * as v from 'valibot'
import { selectSettingsScope, type SettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView, type SettingsView } from '@/features/settings/state/view-store'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'

const KEY = 'settings.view.v1'
const SETTINGS_VIEW_MAX_BYTES = 16_384
const viewSchema = v.object({
  scope: v.picklist(['user', 'workspace', 'default']),
  view: v.picklist(['form', 'json']),
  search: v.pipe(v.string(), v.maxLength(4096)),
  category: v.nullable(v.pipe(v.string(), v.maxLength(200))),
  scrollTop: v.pipe(v.number(), v.minValue(0)),
})
const schema = v.object({
  root: v.nullable(v.string()),
  view: v.optional(viewSchema),
})
type SavedView = v.InferOutput<typeof viewSchema>
type DisplayOwner = {
  root: string | null
  generation: symbol
  view: SavedView | undefined
  storage: ScopedStorage
}
const owners = new WeakMap<QueryClient, DisplayOwner>()
const listeners = new Set<() => void>()

export function subscribeSettingsReload(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function settingsReloadOwner(owner: QueryClient) {
  return owners.get(owner)
}

export function prepareSettingsReload(
  owner: QueryClient,
  storage: ScopedStorage,
  root: string | null,
) {
  const record = readReloadCache<v.InferOutput<typeof schema>>(
    KEY,
    schema,
    storage,
    SETTINGS_VIEW_MAX_BYTES,
  )
  owners.set(owner, {
    root,
    generation: Symbol('settings reload'),
    view: record?.root === root ? record.view : undefined,
    storage,
  })
  for (const listener of listeners) listener()
}

export function restoreSettingsView(owner: QueryClient) {
  const view = owners.get(owner)?.view
  if (!view) return
  selectSettingsScope(view.scope)
  selectSettingsView(view.view)
  selectSettingsSearch(view.search)
  selectSettingsCategory(view.category)
}

export function settingsScrollTop(
  owner: QueryClient,
  scope: SettingsScope,
  view: SettingsView,
  search: string,
  category: string | null = null,
) {
  const saved = owners.get(owner)?.view
  return saved?.scope === scope &&
    saved.view === view &&
    saved.search === search &&
    saved.category === category
    ? saved.scrollTop
    : 0
}

export function settingsReloadGeneration(owner: QueryClient) {
  return owners.get(owner)?.generation
}

export function captureSettingsView(
  owner: QueryClient,
  view: SavedView,
  generation = settingsReloadGeneration(owner),
) {
  const state = owners.get(owner)
  if (!state || state.generation !== generation) return
  state.view = view
  const result = writeWorkspaceCacheEntry(
    KEY,
    { root: state.root, view },
    { storage: state.storage, maxSerializedBytes: SETTINGS_VIEW_MAX_BYTES },
  )
  if (result.status === 'oversized') state.storage.removeItem(KEY)
}
