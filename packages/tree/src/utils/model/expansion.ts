// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'

import type { KnownPaths } from './known-paths'
import { ancestorDirectoryPaths } from '@workspace/utils/slash-paths'

export class Expansion {
  readonly #getStore: () => PathStore
  readonly #knownPaths: KnownPaths
  #applyingBulk = false

  public constructor(getStore: () => PathStore, knownPaths: KnownPaths) {
    this.#getStore = getStore
    this.#knownPaths = knownPaths
  }

  // True while `setExpanded` replays expand/collapse; the controller ignores
  // those store events and rebuilds once afterwards.
  public isApplyingBulk(): boolean {
    return this.#applyingBulk
  }

  public collapse(path: string): void {
    this.#getStore().collapse(path)
  }

  public expand(path: string): void {
    const store = this.#getStore()
    for (const ancestorPath of ancestorDirectoryPaths(path)) {
      if (store.isExpanded(ancestorPath)) {
        continue
      }

      store.expand(ancestorPath)
    }

    if (!store.isExpanded(path)) {
      store.expand(path)
    }
  }

  public toggle(path: string): void {
    if (this.#getStore().isExpanded(path)) {
      this.collapse(path)
      return
    }

    this.expand(path)
  }

  public expandedDirectories(): readonly string[] {
    const store = this.#getStore()
    return this.#knownPaths.directories().filter((path) => store.isExpanded(path))
  }

  public setExpanded(expandedPaths: ReadonlySet<string>): void {
    const store = this.#getStore()
    this.#applyingBulk = true
    try {
      for (const directoryPath of this.#knownPaths.directories()) {
        const shouldExpand = expandedPaths.has(directoryPath)
        const isExpanded = store.isExpanded(directoryPath)
        if (shouldExpand && !isExpanded) {
          store.expand(directoryPath)
        } else if (!shouldExpand && isExpanded) {
          store.collapse(directoryPath)
        }
      }
    } finally {
      this.#applyingBulk = false
    }
  }
}
