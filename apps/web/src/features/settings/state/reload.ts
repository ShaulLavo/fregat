import { readReloadCache } from '@/lib/reload-cache'
import type { SnapshotCaptureSource } from '@/lib/editor-visible-snapshot-cache'
import { settingsSnapshotSchema, type SettingsSnapshot } from '@workspace/contracts'
import { hashKey, type QueryClient } from '@tanstack/react-query'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import * as v from 'valibot'
import { selectSettingsScope, type SettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView, type SettingsView } from '@/features/settings/state/view-store'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'

const KEY = 'settings.display.v1'
const documentQueryHash = hashKey(settingsKeys.document())
export const SETTINGS_RELOAD_MAX_BYTES = 524_288
const viewSchema = v.object({
  scope: v.picklist(['user', 'workspace', 'default']),
  view: v.picklist(['form', 'json']),
  search: v.pipe(v.string(), v.maxLength(4096)),
  category: v.nullable(v.pipe(v.string(), v.maxLength(200))),
  scrollTop: v.pipe(v.number(), v.minValue(0)),
})
const paintSchema = v.object({
  scope: v.picklist(['user', 'workspace', 'default']),
  revision: v.string(),
  theme: v.string(),
  paint: v.pipe(v.string(), v.maxLength(131_072)),
})
type SavedPaint = v.InferOutput<typeof paintSchema>
const schema = v.object({
  root: v.nullable(v.string()),
  snapshot: settingsSnapshotSchema,
  view: v.optional(viewSchema),
  paint: v.optional(paintSchema),
})
type SavedView = v.InferOutput<typeof viewSchema>
type DisplayOwner = {
  root: string | null
  generation: symbol
  saved: SettingsSnapshot | undefined
  view: SavedView | undefined
  paint: SavedPaint | undefined
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
    SETTINGS_RELOAD_MAX_BYTES,
  )
  const matches = record?.root === root
  const state = {
    root,
    generation: Symbol('settings reload'),
    saved: matches ? record.snapshot : undefined,
    view: matches ? record.view : undefined,
    paint: matches ? record.paint : undefined,
    storage,
  }
  owners.set(owner, state)
  for (const listener of listeners) listener()
  return owner.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    if (event.query.queryHash !== documentQueryHash) return
    const snapshot = owner.getQueryData<SettingsSnapshot>(settingsKeys.document())
    if (!snapshot) return
    writeDisplay(state, snapshot)
  })
}

export function savedSettings(owner: QueryClient) {
  return owners.get(owner)?.saved
}

export function settingsPaint(
  owner: QueryClient,
  scope: SettingsScope,
  theme: string,
  revision: string | undefined,
) {
  const paint = owners.get(owner)?.paint
  if (paint?.scope !== scope || paint.theme !== theme || paint.revision !== revision) return null
  return paint.paint
}

export function captureSettingsPaint(
  owner: QueryClient,
  paint: SavedPaint,
  generation = settingsReloadGeneration(owner),
) {
  const state = owners.get(owner)
  const snapshot = owner.getQueryData<SettingsSnapshot>(settingsKeys.document())
  if (!state || state.generation !== generation || !snapshot || paint.paint.length > 131_072) return
  state.paint = paint
  writeDisplay(state, snapshot)
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
  const snapshot = owner.getQueryData<SettingsSnapshot>(settingsKeys.document()) ?? state.saved
  if (snapshot) writeDisplay(state, snapshot)
}

function writeDisplay(state: DisplayOwner, snapshot: SettingsSnapshot) {
  if (
    snapshot.layers.some((layer) => (layer.file?.text.length ?? 0) * 2 > SETTINGS_RELOAD_MAX_BYTES)
  ) {
    state.storage.removeItem(KEY)
    state.saved = undefined
    return
  }
  const result = writeWorkspaceCacheEntry(
    KEY,
    { root: state.root, snapshot, view: state.view, paint: state.paint },
    { storage: state.storage, maxSerializedBytes: SETTINGS_RELOAD_MAX_BYTES },
  )
  if (result.status === 'oversized') {
    state.storage.removeItem(KEY)
    state.saved = undefined
    return
  }
  state.saved = snapshot
}

export function createPaintCapture() {
  let source: SnapshotCaptureSource | null = null
  return {
    read: () => source?.(),
    setSource(next: SnapshotCaptureSource | null) {
      source = next
    },
  }
}
