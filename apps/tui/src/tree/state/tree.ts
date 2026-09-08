import { FileTreeController } from '@workspace/tree/model'
import type { FileTreeEntry, GitFileStatus } from '@workspace/contracts'
import { readDirectory } from '@workspace/client-core/files/read'
import { createRpcError } from '@workspace/client-core/transport/rpc-error'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import { treeEntries } from '@/tree/utils/paths'

export function createWorkbenchTree(session: SettingsSession, rootPath: string) {
  const controller = new FileTreeController({
    paths: [],
    initialExpansion: 'closed',
    flattenEmptyDirectories: false,
    fileTreeSearchMode: 'hide-non-matches',
  })
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
  const unsubscribe = controller.subscribe(publish)
  const serverPath = (path: string) =>
    [rootPath.replace(/\/$/, ''), path.replace(/\/$/, '')].filter(Boolean).join('/')
  function rebuild() {
    entriesByPath = treeEntries([...directories.values()].flat(), rootPath, showHidden)
    const paths = [...entriesByPath.keys()]
    const expanded = paths.filter((path) => {
      const item = controller.getItem(path)
      return item && 'isExpanded' in item && item.isExpanded()
    })
    controller.resetPaths(paths, { initialExpandedPaths: expanded })
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
    await Promise.all([...new Set(['', ...directories.keys()])].map(load))
    const result = await session.client.git.status.get({
      query: { path: rootPath },
      fetch: { signal },
    })
    if (!result.error) statuses = result.data.files
    publish()
  }
  async function open(path: string) {
    const item = controller.getItem(path)
    if (!item?.isDirectory()) return serverPath(path)
    if (!directories.has(path)) await load(path)
    const current = controller.getItem(path)
    if (current && 'toggle' in current) current.toggle()
    return null
  }
  async function mutate(kind: 'file' | 'folder' | 'rename' | 'delete', path: string, value = '') {
    const fullPath = serverPath(path)
    let parent = rootPath
    if (path)
      parent = controller.getItem(path)?.isDirectory()
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
      controller.destroy()
      listeners.clear()
    },
  }
}

export type WorkbenchTree = ReturnType<typeof createWorkbenchTree>
