export type FileTreeRowElement = {
  readonly element: HTMLElement
  readonly path: string
}

type RowElementListener = () => void

/**
 * The row buttons the view has mounted, keyed by path. Flow and sticky rows are
 * separate: a sticky folder row and its flow row can be mounted at once.
 */
export class FileTreeRowElements {
  readonly #flow = new Map<string, HTMLElement>()
  readonly #sticky = new Map<string, HTMLElement>()
  readonly #listeners = new Set<RowElementListener>()
  #notifyQueued = false

  public register(path: string, element: HTMLElement | null, sticky: boolean): void {
    const rows = sticky ? this.#sticky : this.#flow
    if (rows.get(path) === (element ?? undefined)) return

    if (element == null) rows.delete(path)
    else rows.set(path, element)
    this.#queueNotify()
  }

  public rows(): readonly FileTreeRowElement[] {
    const rows: FileTreeRowElement[] = []
    for (const [path, element] of this.#flow) rows.push({ element, path })
    for (const [path, element] of this.#sticky) rows.push({ element, path })
    return rows
  }

  public subscribe(listener: RowElementListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  // A commit re-registers every row through its ref callback; listeners hear it once.
  #queueNotify(): void {
    if (this.#notifyQueued) return

    this.#notifyQueued = true
    queueMicrotask(() => {
      this.#notifyQueued = false
      for (const listener of this.#listeners) listener()
    })
  }
}
