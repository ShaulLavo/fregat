// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStore } from '../path-store/store'
import { createTreeError } from '../structured-errors'

import {
  buildDropOperations,
  createDropContext,
  dropTargetsEqual,
  type FileTreeDragSession,
  isSelfOrDescendantDrop,
  resolveDraggedPathsForStart,
} from './drag-and-drop'
import type {
  FileTreeBatchOperation,
  FileTreeDragAndDropConfig,
  FileTreeDropTarget,
} from './public-types'

export interface DragHost {
  createStore(paths: readonly string[]): PathStore
  emit(): void
  focusPathWithoutEmit(path: string): void
  isFilterActive(): boolean
  resolvePath(path: string): string | null
  selectedPaths(): readonly string[]
  store(): PathStore
}

export interface DragSessionView {
  draggedPaths: readonly string[]
  primaryPath: string
  target: FileTreeDropTarget | null
}

function resolveDragConfig(
  dragAndDrop: boolean | FileTreeDragAndDropConfig | undefined,
): FileTreeDragAndDropConfig | null {
  if (dragAndDrop == null || dragAndDrop === false) return null
  return dragAndDrop === true ? {} : dragAndDrop
}

// The drag in flight: what is dragged and where it would land.
export class Drag {
  readonly #host: DragHost
  readonly #config: FileTreeDragAndDropConfig | null
  #session: FileTreeDragSession | null = null

  public constructor(host: DragHost, dragAndDrop: boolean | FileTreeDragAndDropConfig | undefined) {
    this.#host = host
    this.#config = resolveDragConfig(dragAndDrop)
  }

  public get config(): FileTreeDragAndDropConfig | null {
    return this.#config
  }

  public isActive(): boolean {
    return this.#session != null
  }

  public session(): DragSessionView | null {
    if (this.#session == null) {
      return null
    }

    return {
      draggedPaths: [...this.#session.draggedPaths],
      primaryPath: this.#session.primaryPath,
      target: this.#session.target == null ? null : { ...this.#session.target },
    }
  }

  // Drops the session without an emit; a store mutation ends any drag.
  public clear(): void {
    this.#session = null
  }

  public start(path: string): boolean {
    if (this.#config == null) {
      return false
    }

    const resolvedPath = this.#host.resolvePath(path)
    if (resolvedPath == null) {
      return false
    }

    if (this.#host.isFilterActive()) {
      return false
    }

    const draggedPaths = resolveDraggedPathsForStart(resolvedPath, this.#host.selectedPaths())
    if (this.#config.canDrag?.(draggedPaths) === false) {
      return false
    }

    this.#host.focusPathWithoutEmit(resolvedPath)
    this.#session = {
      draggedPaths,
      primaryPath: resolvedPath,
      target: null,
    }
    this.#host.emit()
    return true
  }

  public setTarget(target: FileTreeDropTarget | null): void {
    const dragSession = this.#session
    if (dragSession == null) {
      return
    }

    let nextTarget = target
    if (nextTarget != null) {
      const context = createDropContext(dragSession.draggedPaths, nextTarget)
      if (
        isSelfOrDescendantDrop(dragSession.draggedPaths, nextTarget) ||
        this.#config?.canDrop?.(context) === false
      ) {
        nextTarget = null
      }
    }

    if (dropTargetsEqual(dragSession.target, nextTarget)) {
      return
    }

    this.#session = {
      ...dragSession,
      target: nextTarget,
    }
    this.#host.emit()
  }

  public cancel(): void {
    if (this.#session == null) {
      return
    }

    this.#session = null
    this.#host.emit()
  }

  public complete(): boolean {
    const dragSession = this.#session
    if (dragSession == null) {
      return false
    }

    // Clear the public drag session before mutating so any store event emitted
    // by the committed move/batch sees drag state as already closed.
    this.#session = null
    const target = dragSession.target == null ? null : { ...dragSession.target }
    if (target == null) {
      this.#host.emit()
      return false
    }

    const dropContext = createDropContext(dragSession.draggedPaths, target)
    if (
      isSelfOrDescendantDrop(dragSession.draggedPaths, target) ||
      this.#config?.canDrop?.(dropContext) === false
    ) {
      this.#host.emit()
      return false
    }

    const dropPlan = buildDropOperations(dragSession.draggedPaths, target)
    if (dropPlan == null) {
      this.#host.emit()
      return false
    }

    try {
      this.#applyDrop(dropPlan.operations)
    } catch (error) {
      this.#host.emit()
      this.#config?.onDropError?.(
        error instanceof Error ? error.message : String(error),
        dropContext,
      )
      return false
    }

    this.#config?.onDropComplete?.(dropPlan.result)
    return true
  }

  #applyDrop(operations: readonly FileTreeBatchOperation[]): void {
    const store = this.#host.store()
    if (operations.length !== 1) {
      this.#validateBatch(operations)
      store.batch(operations)
      return
    }

    const singleOperation = operations[0]
    if (singleOperation == null || singleOperation.type !== 'move') {
      throw createTreeError('Expected a single move operation for one-item drops')
    }

    store.move(singleOperation.from, singleOperation.to, {
      collision: singleOperation.collision,
    })
  }

  // Validate multi-item drop batches against a throwaway store first so a later
  // collision cannot partially mutate the live tree before surfacing the error.
  #validateBatch(operations: readonly FileTreeBatchOperation[]): void {
    const validationStore = this.#host.createStore(this.#host.store().list())
    validationStore.batch(operations)
  }
}
