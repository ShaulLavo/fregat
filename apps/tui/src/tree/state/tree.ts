import {
  FileTreeModel,
  navigateTree,
  normalizeTreePath,
  prepareFileTreeInput,
  type TreeEntryRow,
} from '@shaulavo/workbench-tree'
import type { FileTreeEntry, GitFileStatus } from '@workspace/contracts'
import { readDirectory } from '@workspace/client-core/files/read'
import { createRpcError } from '@workspace/client-core/transport/rpc-error'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import { treeEntries } from '@/tree/utils/paths'

type TuiTreeRow = {
  readonly path: string
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly depth: number
  readonly isExpanded: boolean
  readonly isFocused: boolean
}

function toTuiPath(path: string, kind: 'file' | 'directory') {
  return kind === 'directory' ? `${path}/` : path
}

function entryRows(model: FileTreeModel): readonly TreeEntryRow[] {
  return model.getSnapshot().rows.filter((row): row is TreeEntryRow => row.type === 'entry')
}

function createTuiTreeController(model: FileTreeModel) {
  function navigate(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'Home' | 'End') {
    const snap = model.getSnapshot()
    const action = navigateTree(snap.rows, snap.focusedPath, key)
    if (action.collapse) model.setExpanded(action.collapse, false)
    if (action.focus) model.setFocusedPath(action.focus, 'keyboard')
  }

  return {
    getVisibleRows(start: number, end: number): readonly TuiTreeRow[] {
      return entryRows(model)
        .slice(Math.max(0, start), Math.max(0, end))
        .map((row) => ({
          path: toTuiPath(row.path, row.kind),
          name: row.name,
          kind: row.kind,
          depth: row.depth,
          isExpanded: row.expanded,
          isFocused: row.focused,
        }))
    },
    getFocusedIndex(): number {
      const rows = entryRows(model)
      const focused = model.getSnapshot().focusedPath
      if (!focused) return 0
      const index = rows.findIndex((row) => row.path === focused)
      return index >= 0 ? index : 0
    },
    getFocusedPath(): string | null {
      const focused = model.getSnapshot().focusedPath
      if (!focused) return null
      const kind = model.index.getKind(focused)
      if (!kind) return null
      return toTuiPath(focused, kind)
    },
    getFocusedItem() {
      const focused = model.getSnapshot().focusedPath
      if (!focused) return null
      const kind = model.index.getKind(focused)
      if (!kind) return null
      if (kind !== 'directory') return { isDirectory: () => false as const }
      return {
        isDirectory: () => true as const,
        isExpanded: () => model.getSnapshot().expanded.has(focused),
        collapse: () => model.setExpanded(focused, false),
      }
    },
    focusPath(path: string) {
      const canonical = normalizeTreePath(path)
      if (!canonical || !model.index.hasPath(canonical)) return
      model.setFocusedPath(canonical, 'keyboard')
    },
    focusPreviousItem: () => navigate('ArrowUp'),
    focusNextItem: () => navigate('ArrowDown'),
    focusFirstItem: () => navigate('Home'),
    focusLastItem: () => navigate('End'),
    focusParentItem: () => navigate('ArrowLeft'),
    setSearch(value: string | null) {
      model.setFilter(value ?? '')
    },
    getSearchValue() {
      return model.getSnapshot().filter
    },
  }
}

export function createWorkbenchTree(session: SettingsSession, rootPath: string) {
  const model = new FileTreeModel({ compactFolders: false })
  const controller = createTuiTreeController(model)
  const lifetime = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, session.signal])
  const directories = new Map<string, readonly FileTreeEntry[]>()
  let entriesByPath = new Map<string, FileTreeEntry>()
  const loading = new Set<string>()
  const listeners = new Set<() => void>()
  let version = 0
  let error: string | null = null
  let initialized = false
  let statuses: readonly GitFileStatus[] = []
  let showHidden = false
  const publish = () => {
    if (signal.aborted) return
    version += 1
    for (const listener of listeners) listener()
  }
  const unsubscribe = model.subscribe(publish)
  const serverPath = (path: string) =>
    [rootPath.replace(/\/$/, ''), path.replace(/\/$/, '')].filter(Boolean).join('/')
  function rebuild() {
    entriesByPath = treeEntries(Array.from(directories.values()).flat(), rootPath, showHidden)
    const paths = Array.from(entriesByPath.keys())
    model.replacePreparedInput(prepareFileTreeInput(paths))
    const focused = model.getSnapshot().focusedPath
    if (!focused || !model.index.hasPath(focused)) {
      const first = entryRows(model)[0]
      if (first) model.setFocusedPath(first.path, 'keyboard')
    }
  }
  async function load(path: string) {
    if (signal.aborted || loading.has(path)) return
    loading.add(path)
    error = null
    publish()
    try {
      const result = await readDirectory({ client: session.client, path: serverPath(path), signal })
      directories.set(path, result.entries)
      rebuild()
      initialized = true
    } catch (caught) {
      error = connectionFailure(caught).message
    } finally {
      loading.delete(path)
      publish()
    }
  }
  async function refresh() {
    await Promise.all(Array.from(new Set([''].concat(Array.from(directories.keys())))).map(load))
    const result = await session.client.git.status.get({
      query: { path: rootPath },
      fetch: { signal },
    })
    if (!result.error) statuses = result.data.files
    publish()
  }
  async function open(path: string) {
    const canonical = normalizeTreePath(path)
    if (model.index.getKind(canonical) !== 'directory') return serverPath(path)
    if (!directories.has(path)) await load(path)
    model.toggleExpanded(canonical)
    return null
  }
  async function mutate(kind: 'file' | 'folder' | 'rename' | 'delete', path: string, value = '') {
    const fullPath = serverPath(path)
    const canonical = normalizeTreePath(path)
    let parent = rootPath
    if (path)
      parent =
        model.index.getKind(canonical) === 'directory'
          ? fullPath
          : fullPath.slice(0, Math.max(0, fullPath.lastIndexOf('/')))
    const destination = [parent || rootPath, value].filter(Boolean).join('/')
    const api = session.client.fs
    let response
    if (kind === 'file')
      response = await api['create-file'].post(
        { path: destination, content: '', overwrite: false },
        { fetch: { signal } },
      )
    else if (kind === 'folder')
      response = await api['create-folder'].post(
        { path: destination, recursive: false },
        { fetch: { signal } },
      )
    else if (kind === 'rename')
      response = await api.rename.post(
        {
          from: fullPath,
          to: [fullPath.slice(0, Math.max(0, fullPath.lastIndexOf('/'))), value]
            .filter(Boolean)
            .join('/'),
          overwrite: false,
        },
        { fetch: { signal } },
      )
    else
      response = await api.delete.post({ path: fullPath, recursive: false }, { fetch: { signal } })
    if (response.error) throw createRpcError(response.error)
    directories.clear()
    await refresh()
    session.record({ area: 'tui.tree.mutation', kind, path: fullPath, outcome: 'saved' })
    return destination
  }
  return {
    controller,
    load,
    open,
    refresh,
    mutate,
    serverPath,
    getSnapshot: () => version,
    getStatus: () => ({ error, initialized, pending: loading.size > 0 }),
    isSymlink: (path: string) => entriesByPath.get(path)?.type === 'symlink',
    getGitStatus(path: string) {
      return statuses.find(
        (entry) => entry.path === serverPath(path) || entry.path === path.replace(/\/$/, ''),
      )?.status
    },
    setShowHidden(value: boolean) {
      if (showHidden === value) return
      showHidden = value
      rebuild()
      publish()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      lifetime.abort()
      unsubscribe()
      listeners.clear()
    },
  }
}
