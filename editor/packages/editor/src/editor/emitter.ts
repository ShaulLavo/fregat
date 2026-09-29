type EditorEventListener<T> = (event: T) => void

// Structurally the disposable every registration in this codebase hands back.
// Declared here rather than imported so the event primitive stays a leaf that
// even the document layer can depend on.
export type EditorEventSubscription = {
  dispose(): void
}

type EditorEventSourceOptions = {
  // Names this fan-out in the report a failing listener produces; without it one
  // thrown error looks like any other.
  readonly action: string
}

export class EditorEventSource<T> {
  private readonly listeners = new Set<EditorEventListener<T>>()
  private readonly action: string

  public constructor(options: EditorEventSourceOptions) {
    this.action = options.action
  }

  public subscribe(listener: EditorEventListener<T>): EditorEventSubscription {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  public fire(event: T): void {
    // The listeners are the ones registered when the event happened: a listener
    // that subscribes mid-delivery has not seen the state this event describes,
    // and one that disposes mid-delivery has already released it.
    const subscribed = [...this.listeners]
    for (const listener of subscribed) {
      if (!this.listeners.has(listener)) continue

      try {
        listener(event)
      } catch (error) {
        // Each listener is an independent consumer of a change that has already
        // happened. Letting the first thrower end the pass leaves the rest
        // describing a document that no longer exists, with nothing to tell them
        // otherwise until the next edit.
        //
        // The console is the only reporting channel available: this primitive sits
        // below the document, and anything that could redirect logs is configured
        // above it and would make the leaf depend on its own consumers.
        console.error('[editor]', this.action, error)
      }
    }
  }
}
