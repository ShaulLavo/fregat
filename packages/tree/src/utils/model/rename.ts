// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'
import { renamePaths } from '../rename-paths'

import type { StorePathMutationEvent } from './internal-types'
import { remapPathThroughMutation } from './mutation-events'
import { ancestorDirectoryPaths, isDirectoryPath } from '@workspace/utils/slash-paths'
import type {
  FileTreeRemoveOptions,
  FileTreeRenameEvent,
  FileTreeRenamingConfig,
} from './public-types'
import { getRenameLeafName, toCanonicalRenamePath, toRenameHelperPath } from './rename-helpers'

export interface RenameHost {
  closeFilter(): void
  emit(): void
  focusPathWithoutEmit(path: string): void
  move(fromPath: string, toPath: string): void
  remove(path: string, options?: FileTreeRemoveOptions): void
  selectOnly(path: string): void
  store(): PathStore
}

export interface RenameViewState {
  cancel(): void
  commit(): void
  getPath(): string | null
  getValue(): string
  isActive(): boolean
  setValue(value: string): void
}

export interface StartRenamingOptions {
  removeIfCanceled?: boolean
}

// The inline rename session: the row being renamed and its draft name.
export class Rename {
  readonly #host: RenameHost
  readonly #canRename: FileTreeRenamingConfig['canRename'] | undefined
  readonly #enabled: boolean
  readonly #onRename: ((event: FileTreeRenameEvent) => void) | undefined
  readonly #onRenameError: ((error: string) => void) | undefined
  #path: string | null = null
  #removeIfCanceled = false
  #value = ''

  public constructor(host: RenameHost, renaming: boolean | FileTreeRenamingConfig | undefined) {
    this.#host = host
    this.#enabled = renaming != null && renaming !== false
    const config = renaming != null && renaming !== false && renaming !== true ? renaming : null
    this.#canRename = config?.canRename
    this.#onRenameError = config?.onError
    this.#onRename = config?.onRename
  }

  public start(path: string, options: StartRenamingOptions = {}): boolean {
    if (!this.#enabled) {
      return false
    }

    const store = this.#host.store()
    const itemInfo = store.getPathInfo(path)
    if (itemInfo == null) {
      return false
    }

    const canonicalPath = itemInfo.path
    const isFolder = isDirectoryPath(canonicalPath)
    const publicPath = toRenameHelperPath(canonicalPath)
    if (this.#canRename?.({ isFolder, path: publicPath }) === false) {
      return false
    }

    // Expand any collapsed ancestors so the renaming row can actually mount.
    // If the row stays hidden under a collapsed directory, the React
    // rename-handoff effect keeps asking the view to reveal a row that can
    // never render, spinning the component forever.
    for (const ancestorPath of ancestorDirectoryPaths(canonicalPath)) {
      if (!store.isExpanded(ancestorPath)) {
        store.expand(ancestorPath)
      }
    }

    this.#host.selectOnly(canonicalPath)
    this.#host.closeFilter()
    this.#host.focusPathWithoutEmit(canonicalPath)
    this.#path = canonicalPath
    this.#value = getRenameLeafName(canonicalPath)
    this.#removeIfCanceled = options.removeIfCanceled ?? false
    this.#host.emit()
    return true
  }

  public view(): RenameViewState {
    return {
      cancel: () => {
        this.#cancel()
      },
      commit: () => {
        this.#commit()
      },
      getPath: () => this.#path,
      getValue: () => this.#value,
      isActive: () => this.#path != null,
      setValue: (value: string) => {
        this.#setValue(value)
      },
    }
  }

  public remapThroughMutation(event: StorePathMutationEvent): void {
    const nextPath = remapPathThroughMutation(this.#path, event)
    if (nextPath == null && this.#path != null) {
      this.#value = ''
    }
    this.#path = nextPath
  }

  // Keeps the session on a rebuilt store when its row survived.
  public carryInto(nextStore: PathStore): void {
    this.#path = this.#path == null ? null : (nextStore.getPathInfo(this.#path)?.path ?? null)
    if (this.#path == null) {
      this.#value = ''
      this.#removeIfCanceled = false
    }
  }

  #cancel(): void {
    if (this.#path == null) {
      return
    }

    const renamingPath = this.#path
    const removePlaceholderEntry = this.#removeIfCanceled
    this.#clear()
    if (removePlaceholderEntry) {
      this.#removePlaceholder(renamingPath)
      return
    }
    this.#host.focusPathWithoutEmit(renamingPath)
    this.#host.emit()
  }

  #commit(): void {
    const renamingPath = this.#path
    if (renamingPath == null) {
      return
    }

    if (this.#removeIfCanceled && this.#value.trim().length === 0) {
      this.#clear()
      this.#removePlaceholder(renamingPath)
      return
    }

    const isFolder = isDirectoryPath(renamingPath)
    const result = renamePaths({
      files: this.#host.store().list(),
      isFolder,
      nextBasename: this.#value,
      path: toRenameHelperPath(renamingPath),
    })

    this.#clear()

    if ('error' in result) {
      this.#host.focusPathWithoutEmit(renamingPath)
      this.#onRenameError?.(result.error)
      this.#host.emit()
      return
    }

    if (result.sourcePath === result.destinationPath) {
      this.#host.focusPathWithoutEmit(renamingPath)
      this.#host.emit()
      return
    }

    this.#onRename?.({
      destinationPath: result.destinationPath,
      isFolder: result.isFolder,
      sourcePath: result.sourcePath,
    })
    this.#host.move(
      toCanonicalRenamePath(result.sourcePath, isFolder),
      toCanonicalRenamePath(result.destinationPath, isFolder),
    )
  }

  #setValue(value: string): void {
    if (this.#path == null || this.#value === value) {
      return
    }

    this.#value = value
    this.#host.emit()
  }

  #clear(): void {
    this.#path = null
    this.#value = ''
    this.#removeIfCanceled = false
  }

  #removePlaceholder(path: string): void {
    this.#host.remove(path, isDirectoryPath(path) ? { recursive: true } : undefined)
  }
}
