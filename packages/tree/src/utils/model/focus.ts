// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'

import type { FileTreeScrollRequest } from './internal-types'
import { getImmediateParentPath, getSiblingComparisonKey } from './path-helpers'
import type {
  FileTreeScrollBehavior,
  FileTreeScrollOffset,
  FileTreeScrollToPathOptions,
} from './public-types'
import type { VisibleProjection } from './visible-projection'

export interface FocusHost {
  emit(): void
  ensureFull(): void
  projection: VisibleProjection
  store(): PathStore
}

function normalizeScrollOffset(
  offset: FileTreeScrollToPathOptions['offset'],
): FileTreeScrollOffset {
  return offset === 'top' || offset === 'center' ? offset : 'nearest'
}

function normalizeScrollBehavior(
  behavior: FileTreeScrollToPathOptions['behavior'],
): FileTreeScrollBehavior {
  return behavior === 'smooth' ? 'smooth' : 'auto'
}

// The model-focused row, and the one-shot focus and scroll requests the view drains.
export class Focus {
  readonly #host: FocusHost
  #index = -1
  #path: string | null = null
  #pendingRequestId: number | null = null
  #requestId = 0
  #scrollRequest: FileTreeScrollRequest | null = null
  #scrollRequestId = 0

  public constructor(host: FocusHost) {
    this.#host = host
  }

  public get index(): number {
    return this.#index
  }

  public get path(): string | null {
    return this.#path
  }

  // Takes the focused index a projection rebuild resolved.
  public assign(index: number): void {
    this.#index = index
    this.#path = index < 0 ? null : this.#host.projection.pathAt(index)
  }

  public set(index: number, emit: boolean = true): void {
    const nextPath = this.#host.projection.pathAt(index)
    if (nextPath == null) {
      return
    }

    if (this.#index === index && this.#path === nextPath) {
      return
    }

    this.#index = index
    this.#path = nextPath
    if (emit) {
      this.#host.emit()
    }
  }

  public focusPathWithoutEmit(path: string | null): void {
    if (path == null) {
      return
    }

    const nextFocusedIndex = this.#host.projection.resolveFocusedIndex(path)
    if (nextFocusedIndex >= 0) {
      this.set(nextFocusedIndex, false)
    }
  }

  public first(): void {
    if (this.#host.projection.paths().length > 0) {
      this.set(0)
    }
  }

  public last(): void {
    if (this.#host.projection.count <= 0) {
      return
    }

    this.#host.ensureFull()
    this.set(this.#host.projection.count - 1)
  }

  public move(offset: -1 | 1): void {
    const { projection } = this.#host
    const itemCount = projection.count
    if (itemCount === 0) {
      return
    }

    const currentIndex = this.#index === -1 ? 0 : this.#index
    const nextIndex = Math.min(itemCount - 1, Math.max(0, currentIndex + offset))
    if (nextIndex === currentIndex && this.#index !== -1) {
      return
    }

    if (!projection.isFiltered && projection.needsFullFor(nextIndex)) {
      this.#host.ensureFull()
    }
    this.set(nextIndex)
  }

  public parent(): void {
    if (this.#path == null) {
      return
    }

    const parentPath = getImmediateParentPath(this.#path)
    if (parentPath == null) {
      return
    }

    const nextFocusedIndex = this.#host.projection.resolveFocusedIndex(parentPath)
    if (nextFocusedIndex >= 0) {
      this.set(nextFocusedIndex)
    }
  }

  public focusPath(path: string): void {
    const resolvedPath = this.#host.store().getPathInfo(path)?.path ?? null
    if (resolvedPath == null) {
      return
    }

    this.#host.ensureFull()
    const nextFocusedIndex = this.#host.projection.resolveFocusedIndex(resolvedPath)
    if (nextFocusedIndex >= 0) {
      this.set(nextFocusedIndex)
    }
  }

  // DOM row events already know the target row is mounted, so they can focus it
  // by path without materializing every visible row in large open trees.
  public focusMountedPath(path: string): void {
    const resolvedPath = this.#host.store().getPathInfo(path)?.path ?? null
    if (resolvedPath == null) {
      return
    }

    const nextFocusedIndex = this.#host.projection.resolveFocusedIndex(resolvedPath)
    if (nextFocusedIndex >= 0) {
      this.set(nextFocusedIndex)
    }
  }

  public focusNearest(path: string | null): string | null {
    const nextPath = this.resolveNearest(path)
    if (nextPath == null) {
      return null
    }

    const nextFocusedIndex = this.#host.projection.resolveFocusedIndex(nextPath)
    if (nextFocusedIndex < 0) {
      return null
    }

    this.set(nextFocusedIndex)
    return this.#host.projection.paths()[nextFocusedIndex] ?? nextPath
  }

  public resolveNearest(path: string | null): string | null {
    const { projection } = this.#host
    const currentVisiblePaths = projection.paths()
    if (projection.count === 0) {
      return null
    }

    if (path == null) {
      return this.#path ?? currentVisiblePaths[0] ?? null
    }

    const resolvedPath = this.#host.store().getPathInfo(path)?.path ?? path
    const directIndex = projection.resolveFocusedIndex(resolvedPath)
    if (directIndex >= 0) {
      return currentVisiblePaths[directIndex] ?? resolvedPath
    }

    const siblingPath = this.#nearestVisibleSibling(resolvedPath)
    if (siblingPath != null) {
      return siblingPath
    }

    return this.#path ?? currentVisiblePaths[0] ?? null
  }

  public request(): void {
    this.#requestId += 1
    this.#pendingRequestId = this.#requestId
    this.#host.emit()
  }

  public requestId(): number | null {
    return this.#pendingRequestId
  }

  public clearRequest(id: number): void {
    if (this.#pendingRequestId !== id) return

    this.#pendingRequestId = null
  }

  // Records a one-shot scroll request for the mounted view. By default the
  // target also becomes the model-focused row; callers can pass `focus: false`
  // to reveal a row without changing model focus or DOM focus.
  public scrollTo(path: string, options?: FileTreeScrollToPathOptions): void {
    const { projection } = this.#host
    const resolvedPath = this.#host.store().getPathInfo(path)?.path ?? null
    if (resolvedPath == null) {
      return
    }

    this.#host.ensureFull()
    const targetIndex = projection.exactIndexOf(resolvedPath)
    if (targetIndex < 0) {
      return
    }

    const targetPath = projection.pathAt(targetIndex)
    if (targetPath == null) {
      return
    }

    if (options?.focus !== false) {
      this.set(targetIndex, false)
    }
    this.#scrollRequest = {
      behavior: normalizeScrollBehavior(options?.behavior),
      id: (this.#scrollRequestId += 1),
      offset: normalizeScrollOffset(options?.offset),
      visibleIndex: targetIndex,
    }
    this.#host.emit()
  }

  public scrollRequest(): FileTreeScrollRequest | null {
    return this.#scrollRequest
  }

  public clearScrollRequest(id: number): void {
    if (this.#scrollRequest?.id === id) {
      this.#scrollRequest = null
    }
  }

  #nearestVisibleSibling(path: string): string | null {
    this.#host.ensureFull()
    const parentPath = getImmediateParentPath(path)
    const candidateKey = getSiblingComparisonKey(path, parentPath)
    let previousSiblingPath: string | null = null
    let nextSiblingPath: string | null = null

    for (const siblingPath of this.#host.projection.paths()) {
      if (getImmediateParentPath(siblingPath) !== parentPath) {
        continue
      }

      const siblingKey = getSiblingComparisonKey(siblingPath, parentPath)
      if (siblingKey < candidateKey) {
        previousSiblingPath = siblingPath
        continue
      }

      if (siblingKey > candidateKey) {
        nextSiblingPath = siblingPath
        break
      }
    }

    return previousSiblingPath ?? nextSiblingPath
  }
}
