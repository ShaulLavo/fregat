// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'

import type { Expansion } from './expansion'
import type { StorePathMutationEvent } from './internal-types'
import type { KnownPaths } from './known-paths'
import { remapPathThroughMutation } from './mutation-events'
import { ancestorDirectoryPaths } from '@workspace/utils/slash-paths'
import type { FileTreeSearchMode } from './public-types'
import { normalizeSearchQuery } from './search-helpers'

export interface SearchHost {
  emit(): void
  expansion: Expansion
  focusedPath(): string | null
  focusPath(path: string): void
  knownPaths: KnownPaths
  rebuild(focusedPathCandidate: string | null, full: boolean): void
  selectedPaths(): readonly string[]
  store(): PathStore
}

export interface SearchOptions {
  mode: FileTreeSearchMode | undefined
  onChange: ((value: string | null) => void) | undefined
}

const NO_VISIBLE_PATHS: ReadonlySet<string> = new Set()

// The filter: its query, matches, the expansion it forces and the folders the
// user collapsed while it is open.
export class Search {
  readonly #host: SearchHost
  readonly #mode: FileTreeSearchMode
  readonly #onChange: ((value: string | null) => void) | undefined
  #collapsedOverrides = new Set<string>()
  #focusRequestId = 0
  #matchPathSet = new Set<string>()
  #matchingPaths: readonly string[] = []
  #previousExpandedPaths: readonly string[] | null = null
  #value: string | null = null
  #visiblePathSet: Set<string> | null = null

  public constructor(host: SearchHost, options: SearchOptions) {
    this.#host = host
    this.#mode = options.mode ?? 'hide-non-matches'
    this.#onChange = options.onChange
  }

  public get focusRequestId(): number {
    return this.#focusRequestId
  }

  public get matchingPaths(): readonly string[] {
    return this.#matchingPaths
  }

  // The query, or null while the filter is closed; '' is open and empty.
  public get value(): string | null {
    return this.#value
  }

  public isActive(): boolean {
    return this.#value != null && this.#value.length > 0
  }

  // The rows a hide-non-matches filter keeps, or null when every row shows.
  public visibleFilter(): ReadonlySet<string> | null {
    if (!this.isActive()) return null
    if (this.#mode !== 'hide-non-matches' || this.#matchPathSet.size === 0) return null

    return this.#visiblePathSet ?? NO_VISIBLE_PATHS
  }

  public open(initialValue?: string): void {
    const nextValue = initialValue ?? this.#value ?? ''
    const previousValue = this.#value
    this.#focusRequestId += 1
    this.set(nextValue, true)
    if (previousValue === this.#value) this.#host.emit()
  }

  // Closes the filter for a rename and reports it, without a separate emit.
  public closeForRename(): void {
    if (this.#value == null) return

    this.set(null, false)
    this.#onChange?.(this.#value)
  }

  public focusRelativeMatch(direction: -1 | 1): void {
    const matchPaths = this.#matchingPaths
    if (matchPaths.length === 0) {
      return
    }

    const focusedPath = this.#host.focusedPath()
    const currentIndex = focusedPath == null ? -1 : matchPaths.indexOf(focusedPath)
    const edgeIndex = direction > 0 ? 0 : matchPaths.length - 1
    const nextIndex =
      currentIndex < 0
        ? edgeIndex
        : Math.min(matchPaths.length - 1, Math.max(0, currentIndex + direction))
    const nextPath = matchPaths[nextIndex]
    if (nextPath != null) {
      this.#host.focusPath(nextPath)
    }
  }

  public set(value: string | null, emitChange: boolean): void {
    const normalizedValue = value == null ? null : normalizeSearchQuery(value)
    const previousSearch = this.#value
    if (previousSearch === normalizedValue) {
      return
    }

    if (previousSearch == null && normalizedValue != null) {
      this.#previousExpandedPaths = this.#host.expansion.expandedDirectories()
    }

    this.#value = normalizedValue

    if (normalizedValue == null) {
      this.#collapsedOverrides.clear()
      this.#restoreExpandedPaths(true)
      this.#previousExpandedPaths = null
      this.#clearMatches()
      this.#host.rebuild(this.#host.focusedPath(), true)
    } else if (normalizedValue.length === 0) {
      this.#collapsedOverrides.clear()
      this.#restoreExpandedPaths(false)
      this.#clearMatches()
      this.#host.rebuild(this.#host.focusedPath(), true)
    } else {
      const focusCandidate = this.#refresh()
      this.#host.rebuild(focusCandidate, true)
    }

    if (emitChange) {
      this.#onChange?.(this.#value)
      this.#host.emit()
    }
  }

  public resolveFocusCandidate(focusPathCandidate: string | null): string | null {
    if (this.#value == null) return focusPathCandidate
    if (this.#value.length === 0) return this.#host.focusedPath()

    const refreshedSearchFocusCandidate = this.#refresh()
    if (focusPathCandidate == null) return refreshedSearchFocusCandidate
    if (!this.#isPathVisible(focusPathCandidate)) {
      return refreshedSearchFocusCandidate
    }

    return focusPathCandidate
  }

  public toggleCollapsedOverride(directoryPath: string): void {
    if (!this.isActive()) return
    if (this.#collapsedOverrides.delete(directoryPath)) return
    if (!this.#host.store().isExpanded(directoryPath)) return

    this.#collapsedOverrides.add(directoryPath)
  }

  public remapThroughMutation(event: StorePathMutationEvent): void {
    if (this.#collapsedOverrides.size === 0) return

    const store = this.#host.store()
    const nextOverrides = new Set<string>()
    for (const collapsedPath of this.#collapsedOverrides) {
      const remappedPath = remapPathThroughMutation(collapsedPath, event)
      if (remappedPath == null) continue

      const canonicalPath = store.getPathInfo(remappedPath)?.path
      if (canonicalPath == null || !canonicalPath.endsWith('/')) continue

      nextOverrides.add(canonicalPath)
    }

    this.#collapsedOverrides = nextOverrides
  }

  #clearMatches(): void {
    this.#matchPathSet.clear()
    this.#matchingPaths = []
    this.#visiblePathSet = null
  }

  #restoreExpandedPaths(keepSelectedOpen: boolean): void {
    const expandedPaths = new Set(this.#previousExpandedPaths ?? [])
    if (keepSelectedOpen) {
      for (const selectedPath of this.#host.selectedPaths()) {
        for (const ancestorPath of ancestorDirectoryPaths(selectedPath)) {
          expandedPaths.add(ancestorPath)
        }
      }
    }
    this.#host.expansion.setExpanded(expandedPaths)
  }

  #refresh(): string | null {
    if (!this.isActive()) {
      this.#matchPathSet.clear()
      this.#matchingPaths = []
      return this.#host.focusedPath()
    }

    this.#pruneStaleCollapsedOverrides()
    const { matchingPaths, matchingPathSet, focusCandidate } = this.#collectMatches()
    this.#matchPathSet = matchingPathSet
    this.#matchingPaths = matchingPaths
    const visiblePathSet =
      this.#mode === 'hide-non-matches' && matchingPaths.length > 0 ? new Set<string>() : null
    this.#visiblePathSet = visiblePathSet
    const expandedPaths =
      this.#mode === 'expand-matches'
        ? new Set(this.#previousExpandedPaths ?? [])
        : new Set<string>()

    for (const matchingPath of matchingPaths) {
      visiblePathSet?.add(matchingPath)
      if (matchingPath.endsWith('/')) {
        expandedPaths.add(matchingPath)
      }
      for (const ancestorPath of ancestorDirectoryPaths(matchingPath)) {
        expandedPaths.add(ancestorPath)
        visiblePathSet?.add(ancestorPath)
      }
    }

    for (const collapsedPath of this.#collapsedOverrides) {
      expandedPaths.delete(collapsedPath)
      this.#keepCollapsedOverrideVisible(collapsedPath, visiblePathSet)
    }

    this.#host.expansion.setExpanded(expandedPaths)
    return focusCandidate ?? this.#host.focusedPath()
  }

  #collectMatches(): {
    focusCandidate: string | null
    matchingPathSet: Set<string>
    matchingPaths: string[]
  } {
    const searchValue = this.#value ?? ''
    const { knownPaths } = this.#host
    const listedPaths = knownPaths.listed()
    const listedPathsLowerCase = knownPaths.listedLowerCase()
    const matchingPaths: string[] = []
    const matchingPathSet = new Set<string>()
    let focusCandidate: string | null = null

    for (let index = 0; index < listedPaths.length; index += 1) {
      const lowerPath = listedPathsLowerCase[index]
      if (!lowerPath.includes(searchValue)) {
        continue
      }

      const path = listedPaths[index]
      matchingPaths.push(path)
      matchingPathSet.add(path)
      focusCandidate ??= path
    }

    const knownDirectoryPaths = knownPaths.directories()
    const knownDirectoryPathsLowerCase = knownPaths.directoriesLowerCase()
    for (let index = 0; index < knownDirectoryPaths.length; index += 1) {
      const lowerPath = knownDirectoryPathsLowerCase[index]
      if (!lowerPath.includes(searchValue)) {
        continue
      }

      const path = knownDirectoryPaths[index]
      if (matchingPathSet.has(path)) {
        continue
      }

      matchingPaths.push(path)
      matchingPathSet.add(path)
      focusCandidate ??= path
    }

    return { focusCandidate, matchingPathSet, matchingPaths }
  }

  #keepCollapsedOverrideVisible(collapsedPath: string, visiblePathSet: Set<string> | null): void {
    if (visiblePathSet == null) return

    visiblePathSet.add(collapsedPath)
    for (const ancestorPath of ancestorDirectoryPaths(collapsedPath)) {
      visiblePathSet.add(ancestorPath)
    }
  }

  #pruneStaleCollapsedOverrides(): void {
    const store = this.#host.store()
    for (const collapsedPath of this.#collapsedOverrides) {
      const pathInfo = store.getPathInfo(collapsedPath)
      if (pathInfo?.kind === 'directory' && pathInfo.path === collapsedPath) continue

      this.#collapsedOverrides.delete(collapsedPath)
    }
  }

  #isPathVisible(path: string): boolean {
    if (this.#visiblePathSet != null) {
      return this.#visiblePathSet.has(path)
    }

    return this.#host.store().getVisibleIndex(path) != null
  }
}
