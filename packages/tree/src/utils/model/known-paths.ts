// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'

import { ancestorDirectoryPaths } from '@workspace/utils/slash-paths'
import { toLowerCaseSearchPath } from './path-helpers'

// Listed and known paths, cached until the canonical tree changes.
export class KnownPaths {
  readonly #getStore: () => PathStore
  #directoryPaths: readonly string[] | null = null
  #directoryPathsLowerCase: readonly string[] | null = null
  #knownPaths: readonly string[] | null = null
  #listedPaths: readonly string[] | null = null
  #listedPathsLowerCase: readonly string[] | null = null

  public constructor(getStore: () => PathStore) {
    this.#getStore = getStore
  }

  public listed(): readonly string[] {
    if (this.#listedPaths != null) {
      return this.#listedPaths
    }

    this.#listedPaths = this.#getStore().list()
    return this.#listedPaths
  }

  // Cache lowercased path keys once so incremental search does not re-normalize
  // every file and directory path on each keystroke.
  public listedLowerCase(): readonly string[] {
    if (this.#listedPathsLowerCase != null) {
      return this.#listedPathsLowerCase
    }

    this.#listedPathsLowerCase = this.listed().map(toLowerCaseSearchPath)
    return this.#listedPathsLowerCase
  }

  public directories(): readonly string[] {
    if (this.#directoryPaths != null) {
      return this.#directoryPaths
    }

    this.#directoryPaths = this.#all().filter((path) => path.endsWith('/'))
    return this.#directoryPaths
  }

  public directoriesLowerCase(): readonly string[] {
    if (this.#directoryPathsLowerCase != null) {
      return this.#directoryPathsLowerCase
    }

    this.#directoryPathsLowerCase = this.directories().map(toLowerCaseSearchPath)
    return this.#directoryPathsLowerCase
  }

  public invalidate(): void {
    this.#directoryPaths = null
    this.#directoryPathsLowerCase = null
    this.#knownPaths = null
    this.#listedPaths = null
    this.#listedPathsLowerCase = null
  }

  #all(): readonly string[] {
    if (this.#knownPaths != null) {
      return this.#knownPaths
    }

    const knownPaths = new Set<string>()
    for (const path of this.listed()) {
      knownPaths.add(path)
      for (const ancestorPath of ancestorDirectoryPaths(path)) {
        knownPaths.add(ancestorPath)
      }
    }

    this.#knownPaths = [...knownPaths].sort()
    return this.#knownPaths
  }
}
