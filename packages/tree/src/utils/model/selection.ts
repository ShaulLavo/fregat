// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'

import type { Focus } from './focus'
import type { StorePathMutationEvent } from './internal-types'
import { remapPathThroughMutation } from './mutation-events'
import { arePathSetsEqual } from './path-helpers'
import type { VisibleProjection } from './visible-projection'

export interface SelectionHost {
  emit(): void
  ensureFull(): void
  focus: Focus
  projection: VisibleProjection
  store(): PathStore
}

export class Selection {
  readonly #host: SelectionHost
  #anchorPath: string | null = null
  #paths = new Set<string>()
  #version = 0

  public constructor(host: SelectionHost) {
    this.#host = host
  }

  public get anchorPath(): string | null {
    return this.#anchorPath
  }

  public get version(): number {
    return this.#version
  }

  public has(path: string): boolean {
    return this.#paths.has(path)
  }

  public paths(): string[] {
    return Array.from(this.#paths)
  }

  // Resolves each path against the store; returns the resolved ones.
  public initialize(paths: readonly string[]): readonly string[] {
    const resolvedPaths = paths
      .map((path) => this.#resolve(path))
      .filter((resolved): resolved is string => resolved != null)
    if (resolvedPaths.length > 0) {
      this.#paths = new Set(resolvedPaths)
      this.#anchorPath = resolvedPaths.at(-1) ?? null
      this.#version = 1
    }
    return resolvedPaths
  }

  public apply(
    nextSelectedPaths: readonly string[],
    nextAnchorPath: string | null = this.#anchorPath,
    emit: boolean = true,
  ): void {
    const uniqueSelectedPaths = Array.from(new Set(nextSelectedPaths))
    const selectionChanged = !arePathSetsEqual(this.#paths, uniqueSelectedPaths)
    const anchorChanged = this.#anchorPath !== nextAnchorPath
    if (!selectionChanged && !anchorChanged) {
      return
    }

    this.#paths = new Set(uniqueSelectedPaths)
    this.#anchorPath = nextAnchorPath
    if (selectionChanged) {
      this.#version += 1
    }
    if (emit) {
      this.#host.emit()
    }
  }

  public selectAllVisible(): void {
    this.#host.ensureFull()
    const nextSelectedPaths = this.#host.projection.paths()
    this.apply(nextSelectedPaths, this.#host.focus.path ?? this.#anchorPath)
  }

  public selectOnly(path: string): void {
    const resolvedPath = this.#resolve(path)
    if (resolvedPath == null) {
      return
    }

    this.apply([resolvedPath], resolvedPath)
  }

  public select(path: string): void {
    const resolvedPath = this.#resolve(path)
    if (resolvedPath == null || this.#paths.has(resolvedPath)) {
      return
    }

    this.apply(Array.from(this.#paths).concat(resolvedPath))
  }

  public deselect(path: string): void {
    const resolvedPath = this.#resolve(path)
    if (resolvedPath == null || !this.#paths.has(resolvedPath)) {
      return
    }

    this.apply(Array.from(this.#paths).filter((selectedPath) => selectedPath !== resolvedPath))
  }

  public toggle(path: string): void {
    const resolvedPath = this.#resolve(path)
    if (resolvedPath == null) {
      return
    }

    if (this.#paths.has(resolvedPath)) {
      this.deselect(resolvedPath)
      return
    }

    this.select(resolvedPath)
  }

  public toggleFromInput(path: string): void {
    const resolvedPath = this.#resolve(path)
    if (resolvedPath == null) {
      return
    }

    if (this.#paths.has(resolvedPath)) {
      this.apply(
        Array.from(this.#paths).filter((selectedPath) => selectedPath !== resolvedPath),
        resolvedPath,
      )
      return
    }

    this.apply(Array.from(this.#paths).concat(resolvedPath), resolvedPath)
  }

  public selectRange(path: string, unionSelection: boolean): void {
    const resolvedPath = this.#resolve(path)
    if (resolvedPath == null) {
      return
    }

    const { projection } = this.#host
    this.#host.ensureFull()
    const anchorPath = this.#anchorPath
    const anchorIndex = anchorPath == null ? -1 : projection.indexOf(anchorPath)
    const targetIndex = projection.indexOf(resolvedPath)
    if (anchorIndex === -1 || targetIndex === -1) {
      const nextSelectedPaths = unionSelection
        ? Array.from(this.#paths).concat(resolvedPath)
        : [resolvedPath]
      this.apply(nextSelectedPaths, resolvedPath)
      return
    }

    const [startIndex, endIndex] =
      anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    const rangePaths = projection.paths().slice(startIndex, endIndex + 1)
    const nextSelectedPaths = unionSelection
      ? Array.from(this.#paths).concat(rangePaths)
      : rangePaths
    this.apply(nextSelectedPaths, anchorPath)
  }

  public extendFromFocused(offset: -1 | 1): void {
    const { focus, projection } = this.#host
    if (focus.path == null) {
      return
    }

    const focusedIndex = focus.index
    if (focusedIndex === -1) {
      return
    }

    const nextIndex = Math.min(projection.count - 1, Math.max(0, focusedIndex + offset))
    if (nextIndex === focusedIndex) {
      return
    }

    if (projection.needsFullFor(nextIndex)) {
      this.#host.ensureFull()
    }

    const visiblePaths = projection.paths()
    const currentPath = visiblePaths[focusedIndex] ?? null
    const nextPath = visiblePaths[nextIndex] ?? null
    if (currentPath == null || nextPath == null) {
      return
    }

    const nextSelectedPaths = new Set(this.#paths)
    if (nextSelectedPaths.has(currentPath) && nextSelectedPaths.has(nextPath)) {
      nextSelectedPaths.delete(currentPath)
    } else {
      nextSelectedPaths.add(nextPath)
    }

    this.apply(Array.from(nextSelectedPaths), this.#anchorPath ?? currentPath, false)
    focus.set(nextIndex)
  }

  // Carries selection into a rebuilt store; returns whether any selection survives.
  public carryInto(nextStore: PathStore): boolean {
    const nextSelectedPaths = this.paths()
      .map((selectedPath) => nextStore.getPathInfo(selectedPath)?.path ?? null)
      .filter((resolved): resolved is string => resolved != null)
    const selectionChanged = !arePathSetsEqual(this.#paths, nextSelectedPaths)
    this.#paths = new Set(nextSelectedPaths)
    if (selectionChanged) {
      this.#version += 1
    }
    this.#anchorPath =
      this.#anchorPath == null ? null : (nextStore.getPathInfo(this.#anchorPath)?.path ?? null)
    return nextSelectedPaths.length > 0 || this.#anchorPath != null
  }

  public remapThroughMutation(event: StorePathMutationEvent): void {
    const store = this.#host.store()
    const nextSelectedPaths = Array.from(this.#paths, (selectedPath) =>
      remapPathThroughMutation(selectedPath, event),
    )
      .filter((resolvedPath): resolvedPath is string => resolvedPath != null)
      .map((resolvedPath) => store.getPathInfo(resolvedPath)?.path ?? null)
      .filter((resolvedPath): resolvedPath is string => resolvedPath != null)
    const nextAnchorPath = remapPathThroughMutation(this.#anchorPath, event)
    const canonicalAnchorPath =
      nextAnchorPath == null ? null : (store.getPathInfo(nextAnchorPath)?.path ?? null)
    const uniqueNextSelectedPaths = Array.from(new Set(nextSelectedPaths))
    const selectionChanged = !arePathSetsEqual(this.#paths, uniqueNextSelectedPaths)
    if (selectionChanged) {
      this.#paths = new Set(uniqueNextSelectedPaths)
      this.#version += 1
    }

    this.#anchorPath = canonicalAnchorPath
  }

  #resolve(path: string): string | null {
    return this.#host.store().getPathInfo(path)?.path ?? null
  }
}
