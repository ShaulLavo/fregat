export type EditorDisposable = {
  dispose(): void
}

// Post-teardown rule shared by both owners below: a disposed owner never retains again, since no
// later unwind is left to hand the work to. Anything handed over anyway is unwound on the spot,
// while a caller that sees the teardown first refuses before building: same guarantee, less churn.

/**
 * Ownership for a group of disposables: one owner unwinds everything it was given in a single call.
 */
export class EditorDisposableStore implements EditorDisposable {
  private readonly disposables = new Set<EditorDisposable>()
  private disposed = false

  get size(): number {
    return this.disposables.size
  }

  add<T extends EditorDisposable>(disposable: T): T {
    if (this.disposed) {
      disposable.dispose()
      return disposable
    }

    this.disposables.add(disposable)
    return disposable
  }

  /**
   * Drops a disposable the caller has already unwound itself, so a long-lived store does not retain
   * everything a caller ever registered and released.
   */
  delete(disposable: EditorDisposable): void {
    this.disposables.delete(disposable)
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    // Newest first: a later entry can depend on an earlier one, never the other way round.
    const pending = [...this.disposables].reverse()
    this.disposables.clear()
    for (const disposable of pending) disposable.dispose()
  }
}

/**
 * A single slot that disposes whatever it was holding when a new value moves in, so a subscription
 * that is re-created cannot strand the one it replaces.
 */
export class MutableEditorDisposable implements EditorDisposable {
  private current: EditorDisposable | null = null
  private disposed = false

  set value(next: EditorDisposable | null) {
    if (next === this.current) return

    const previous = this.current
    this.current = next
    previous?.dispose()
    if (this.disposed) this.clear()
  }

  private clear(): void {
    const previous = this.current
    this.current = null
    previous?.dispose()
  }

  dispose(): void {
    this.disposed = true
    this.clear()
  }
}
