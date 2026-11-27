export type TreeRowElement = {
  readonly element: HTMLElement
  readonly path: string
}

type RowElementListener = () => void

/**
 * Tracks mounted tree row elements keyed by canonical tree path so hover prefetch
 * and context-menu focus restoration can reach live DOM nodes without querying the tree.
 */
export class TreeRowElements {
  readonly #rows = new Map<string, HTMLElement>()
  readonly #listeners = new Set<RowElementListener>()
  #notifyQueued = false

  public register(path: string, element: HTMLElement | null): void {
    if (this.#rows.get(path) === (element ?? undefined)) return

    if (element == null) this.#rows.delete(path)
    else this.#rows.set(path, element)
    this.#queueNotify()
  }

  public element(path: string): HTMLElement | null {
    return this.#rows.get(path) ?? null
  }

  public rows(): readonly TreeRowElement[] {
    return Array.from(this.#rows, ([path, element]) => ({ element, path }))
  }

  public subscribe(listener: RowElementListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  // A commit re-registers every mounted row through its ref callback; notify once per microtask.
  #queueNotify(): void {
    if (this.#notifyQueued) return

    this.#notifyQueued = true
    queueMicrotask(() => {
      this.#notifyQueued = false
      for (const listener of this.#listeners) listener()
    })
  }
}
