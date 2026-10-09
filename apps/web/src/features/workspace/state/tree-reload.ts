import { readReloadCache } from '@/lib/reload-cache'
import type { QueryClient } from '@tanstack/react-query'
import { entryTypeSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { DirectoryLoadError, TreeModel } from '@/lib/tree-model'

const KEY = 'workspace.tree-display.v1'
export const TREE_RELOAD_MAX_BYTES = 262_144
const MAX_ENTRIES = 1500
const path = v.pipe(v.string(), v.maxLength(4096), v.transform(filesystemPath))
const entry = v.object({
  path,
  name: v.pipe(v.string(), v.maxLength(1024)),
  type: entryTypeSchema,
  targetType: v.optional(entryTypeSchema),
  canonicalPath: v.optional(path),
  size: v.number(),
  mtimeMs: v.number(),
  birthtimeMs: v.number(),
  version: v.string(),
})
const gitSchema = v.object({
  observedAt: v.number(),
  entries: v.pipe(
    v.array(
      v.object({
        path: v.pipe(v.string(), v.maxLength(4096)),
        status: v.picklist(['added', 'deleted', 'ignored', 'modified', 'renamed', 'untracked']),
      }),
    ),
    v.maxLength(MAX_ENTRIES),
  ),
})
const schema = v.object({
  root: path,
  worktree: v.nullable(v.string()),
  activeFile: v.nullable(path),
  git: v.optional(gitSchema),
  observedAt: v.number(),
  entries: v.pipe(v.array(v.tuple([v.string(), entry])), v.maxLength(MAX_ENTRIES)),
  paths: v.pipe(v.array(v.string()), v.maxLength(MAX_ENTRIES)),
  loaded: v.pipe(v.array(v.string()), v.maxLength(MAX_ENTRIES)),
  expanded: v.pipe(v.array(v.string()), v.maxLength(MAX_ENTRIES)),
  selected: v.pipe(v.array(v.string()), v.maxLength(MAX_ENTRIES)),
  scrollTop: v.pipe(v.number(), v.minValue(0)),
})
type Record = Omit<v.InferOutput<typeof schema>, 'selected'> & {
  readonly selected: readonly string[]
}
type Observation = { readonly record: Record; readonly model: TreeModel }
const owners = new WeakMap<
  QueryClient,
  { storage: ScopedStorage; saved: Map<string, Observation | null>; persistedRoot: string | null }
>()

export function prepareTreeReload(owner: QueryClient, storage: ScopedStorage) {
  const record = readReloadCache<Record>(KEY, schema, storage, TREE_RELOAD_MAX_BYTES)
  const saved = record
    ? {
        record,
        model: {
          paths: record.paths,
          entriesByTreePath: new Map(record.entries),
          loadedDirectoryPaths: new Set(record.loaded),
          loadingDirectoryPaths: new Set<string>(),
          errorByDirectoryPath: new Map<string, DirectoryLoadError>(),
        },
      }
    : null
  owners.set(owner, {
    storage,
    saved: new Map(saved ? [[saved.record.root, saved]] : []),
    persistedRoot: record?.root ?? null,
  })
}

export function savedTree(owner: QueryClient, root: string, worktree: string | null) {
  const saved = owners.get(owner)?.saved.get(root)
  return saved?.record.root === root && saved.record.worktree === worktree ? saved : null
}

export function forgetTree(owner: QueryClient, root: string) {
  const state = owners.get(owner)
  if (!state) return
  state.saved.set(root, null)
  if (state.persistedRoot !== root) return
  state.storage.removeItem(KEY)
  state.persistedRoot = null
}

export function confirmTreeRoot(owner: QueryClient, root: string) {
  const saved = owners.get(owner)?.saved
  if (saved?.get(root) === null) saved.delete(root)
}

export function captureTree(
  owner: QueryClient,
  model: TreeModel,
  view: Pick<
    Record,
    'root' | 'worktree' | 'activeFile' | 'git' | 'expanded' | 'selected' | 'scrollTop'
  >,
  observedAt = Date.now(),
) {
  const state = owners.get(owner)
  if (!state) return
  // A held pane can unmount after a missing-root response has discarded its observation.
  if (state.saved.get(view.root) === null) return
  if (
    model.entriesByTreePath.size > MAX_ENTRIES ||
    model.paths.length > MAX_ENTRIES ||
    (view.git?.entries.length ?? 0) > MAX_ENTRIES
  ) {
    state.storage.removeItem(KEY)
    state.saved.delete(view.root)
    return
  }
  const record: Record = {
    ...view,
    observedAt,
    paths: model.paths,
    entries: Array.from(model.entriesByTreePath, ([path, value]) => {
      const { children: _children, ...metadata } = value
      return [path, metadata]
    }),
    loaded: [...model.loadedDirectoryPaths],
  }
  const result = writeWorkspaceCacheEntry(KEY, record, {
    storage: state.storage,
    maxSerializedBytes: TREE_RELOAD_MAX_BYTES,
  })
  if (result.status === 'oversized') {
    state.storage.removeItem(KEY)
    state.saved.delete(view.root)
    return
  }
  state.saved.set(view.root, { record, model })
  state.persistedRoot = view.root
}
