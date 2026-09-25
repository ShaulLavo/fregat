import { createObservableStore } from '@/host/state/observable-store'
import { isDirectoryEntry, type FileTreeEntry } from '@workspace/contracts'
import {
  readDirectory,
  readEntry,
  readFilePreview,
  readServerPaths,
} from '@workspace/client-core/files/read'
import { absolutePickerPath, parsePickerPathInput } from '@workspace/client-core/files/path-input'
import type { Client } from '@workspace/client-core/transport/client'
import type { KeyValueStorage } from '@workspace/client-core/storage'

import { connectionFailure } from '@/connection/utils/failure'
import { parentDirectory, parseBrowserPathInput, type FileLocation } from '@/files/utils/list'

type ServerPaths = Awaited<ReturnType<typeof readServerPaths>>
type Listing =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly entries: readonly FileTreeEntry[] }
type Preview =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'failed'; readonly path: string; readonly message: string }
  | { readonly kind: 'ready'; readonly path: string; readonly content: string }

export function createFileBrowser(client: Client, storage: KeyValueStorage) {
  const store = createObservableStore<{
    paths: ServerPaths | null
    path: string
    parentPath: string | null
    listing: Listing
    preview: Preview
    location: FileLocation | null
  }>({
    paths: null,
    path: '',
    parentPath: null,
    listing: { kind: 'loading' },
    preview: { kind: 'empty' },
    location: null,
  })
  let request = new AbortController()
  let preview = new AbortController()

  function publish(next: typeof store.value) {
    store.replace({ ...next, parentPath: next.path ? parentDirectory(next.path) : null })
  }

  async function navigate(path: string) {
    if (store.disposed) return
    request.abort()
    preview.abort()
    const controller = new AbortController()
    request = controller
    await loadDirectory(path, controller)
  }

  async function loadDirectory(
    path: string,
    controller: AbortController,
    destination: 'directory' | 'file' = 'directory',
  ) {
    publish({ ...store.value, path, listing: { kind: 'loading' }, preview: { kind: 'empty' } })
    try {
      const result = await readDirectory({ client, path, signal: controller.signal })
      controller.signal.throwIfAborted()
      const entries = result.entries.toSorted(
        (left, right) =>
          Number(isDirectoryEntry(right)) - Number(isDirectoryEntry(left)) ||
          left.name.localeCompare(right.name),
      )
      storage.setItem('file-picker-directory', result.path)
      const location: FileLocation | null =
        store.value.paths && destination === 'directory'
          ? {
              path: result.path,
              rootPath: result.path,
              kind: 'directory',
            }
          : store.value.location
      publish({ ...store.value, path: result.path, listing: { kind: 'ready', entries }, location })
      return !controller.signal.aborted
    } catch (error) {
      if (controller.signal.aborted) return false
      publish({
        ...store.value,
        listing: { kind: 'failed', message: connectionFailure(error).message },
      })
      return false
    }
  }

  async function open(initialPath?: string) {
    if (store.disposed) return
    request.abort()
    preview.abort()
    const controller = new AbortController()
    request = controller
    try {
      const paths = await readServerPaths({ client, signal: controller.signal })
      controller.signal.throwIfAborted()
      publish({ ...store.value, paths })
      const input = initialPath ?? storage.getItem('file-picker-directory') ?? paths.defaultPath
      const parsed = input ? parsePickerPathInput(input, paths) : { error: null, path: '' }
      if (parsed.error !== null) {
        publish({ ...store.value, listing: { kind: 'failed', message: parsed.error } })
        return
      }
      if (initialPath !== undefined && parsed.path) {
        await openEntry(parsed.path, controller)
        return
      }
      await loadDirectory(parsed.path, controller)
    } catch (error) {
      if (controller.signal.aborted) return
      publish({
        ...store.value,
        listing: { kind: 'failed', message: connectionFailure(error).message },
      })
    }
  }

  async function openEntry(path: string, controller: AbortController) {
    const entry = await readEntry({ client, path, signal: controller.signal })
    controller.signal.throwIfAborted()
    if (isDirectoryEntry(entry)) {
      await loadDirectory(path, controller)
      return
    }
    if (!(await loadDirectory(parentDirectory(path), controller, 'file'))) return
    controller.signal.throwIfAborted()
    await select({ ...entry, name: path.split('/').at(-1) ?? path })
  }

  async function select(entry: FileTreeEntry) {
    if (isDirectoryEntry(entry)) return navigate(entry.path)
    if (store.disposed) return
    preview.abort()
    const controller = new AbortController()
    preview = controller
    publish({ ...store.value, preview: { kind: 'loading', path: entry.path } })
    try {
      // A glance pane in a terminal: raw control bytes would wreck the render, and nobody asked
      // to open this file. Deliberate opens stay permissive and show whatever is there.
      const file = await readFilePreview({
        acceptTextOnly: true,
        client,
        path: entry.path,
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()
      const location: FileLocation | null = store.value.paths
        ? {
            path: file.path,
            rootPath: parentDirectory(file.path),
            kind: 'file',
          }
        : store.value.location
      publish({
        ...store.value,
        preview: { kind: 'ready', path: file.path, content: file.content },
        location,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      publish({
        ...store.value,
        preview: { kind: 'failed', path: entry.path, message: connectionFailure(error).message },
      })
    }
  }

  async function completePath(input: string) {
    if (!store.value.paths || store.disposed) return input
    const parsed = parseBrowserPathInput({
      input,
      currentPath: store.value.path,
      paths: store.value.paths,
    })
    if (parsed.error !== null) return input
    const directoryInput = input.trim().endsWith('/')
    const parent = directoryInput ? parsed.path : parentDirectory(parsed.path)
    const prefix = directoryInput ? '' : (parsed.path.split('/').at(-1) ?? '')
    const signal = request.signal
    try {
      const result = await readDirectory({ client, path: parent, signal })
      signal.throwIfAborted()
      const matches = result.entries.filter(
        (entry) => isDirectoryEntry(entry) && entry.name.startsWith(prefix),
      )
      if (matches.length !== 1) return input
      return `${absolutePickerPath(matches[0].path, store.value.paths.workspaceRoot)}/`
    } catch (error) {
      if (signal.aborted) return input
      throw error
    }
  }

  return {
    open,
    navigate,
    async goUp() {
      if (store.value.parentPath === null) return
      await navigate(store.value.parentPath)
    },
    select,
    completePath,
    clearPreview() {
      if (store.value.preview.kind === 'empty') return
      preview.abort()
      const location: FileLocation | null =
        store.value.paths && store.value.listing.kind === 'ready'
          ? {
              path: store.value.path,
              rootPath: store.value.path,
              kind: 'directory',
            }
          : store.value.location
      publish({ ...store.value, preview: { kind: 'empty' }, location })
    },
    enterPath(input: string) {
      if (!store.value.paths) return 'Server paths are not available yet.'
      const parsed = parseBrowserPathInput({
        input,
        currentPath: store.value.path,
        paths: store.value.paths,
      })
      if (parsed.error !== null) return parsed.error
      void navigate(parsed.path)
      return null
    },
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispose() {
      store.dispose()
      request.abort()
      preview.abort()
    },
  }
}

export type FileBrowser = ReturnType<typeof createFileBrowser>
