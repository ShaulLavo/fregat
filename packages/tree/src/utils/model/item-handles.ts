// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStorePathInfo } from '../path-store/public-types'
import type { PathStore } from '../path-store/store'

import type { Expansion } from './expansion'
import type { Focus } from './focus'
import type {
  FileTreeDirectoryHandle,
  FileTreeFileHandle,
  FileTreeItemHandle,
} from './public-types'
import type { Selection } from './selection'

export interface ItemHandlesHost {
  expansion: Expansion
  focus: Focus
  selection: Selection
  store(): PathStore
}

// One cached handle per canonical path, dropped whenever the tree changes.
export class ItemHandles {
  readonly #host: ItemHandlesHost
  readonly #handles = new Map<string, FileTreeItemHandle>()

  public constructor(host: ItemHandlesHost) {
    this.#host = host
  }

  public clear(): void {
    this.#handles.clear()
  }

  public get(path: string, itemInfo?: PathStorePathInfo): FileTreeItemHandle | null {
    const cachedHandle = this.#handles.get(path)
    if (cachedHandle != null) {
      return cachedHandle
    }

    const resolvedItemInfo = itemInfo ?? this.#host.store().getPathInfo(path)
    if (resolvedItemInfo == null) {
      return null
    }

    const handle =
      resolvedItemInfo.kind === 'directory'
        ? this.#createDirectoryHandle(resolvedItemInfo.path)
        : this.#createFileHandle(resolvedItemInfo.path)
    this.#handles.set(resolvedItemInfo.path, handle)
    return handle
  }

  #createDirectoryHandle(path: string): FileTreeDirectoryHandle {
    const { expansion, focus, selection } = this.#host
    return {
      collapse: () => {
        expansion.collapse(path)
      },
      deselect: () => {
        selection.deselect(path)
      },
      expand: () => {
        expansion.expand(path)
      },
      focus: () => {
        focus.focusPath(path)
      },
      getPath: () => path,
      isDirectory: () => true,
      isExpanded: () => this.#host.store().isExpanded(path),
      isFocused: () => focus.path === path,
      isSelected: () => selection.has(path),
      select: () => {
        selection.select(path)
      },
      toggleSelect: () => {
        selection.toggle(path)
      },
      toggle: () => {
        expansion.toggle(path)
      },
    }
  }

  #createFileHandle(path: string): FileTreeFileHandle {
    const { focus, selection } = this.#host
    return {
      deselect: () => {
        selection.deselect(path)
      },
      focus: () => {
        focus.focusPath(path)
      },
      getPath: () => path,
      isDirectory: () => false,
      isFocused: () => focus.path === path,
      isSelected: () => selection.has(path),
      select: () => {
        selection.select(path)
      },
      toggleSelect: () => {
        selection.toggle(path)
      },
    }
  }
}
