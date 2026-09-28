// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type {
  FileTreeMutationEvent,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
} from './public-types'

type MutationListener = (event: FileTreeMutationEvent) => void

export class MutationListeners {
  readonly #listeners = new Map<FileTreeMutationEventType | '*', Set<MutationListener>>()

  public on<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void,
  ): () => void {
    const typedHandler = handler as MutationListener
    let listenersForType = this.#listeners.get(type)
    if (listenersForType == null) {
      listenersForType = new Set()
      this.#listeners.set(type, listenersForType)
    }
    listenersForType.add(typedHandler)
    return () => {
      const registeredListeners = this.#listeners.get(type)
      registeredListeners?.delete(typedHandler)
      if (registeredListeners?.size === 0) {
        this.#listeners.delete(type)
      }
    }
  }

  public emit(event: FileTreeMutationEvent): void {
    this.#listeners.get(event.operation)?.forEach((listener) => {
      listener(event)
    })
    this.#listeners.get('*')?.forEach((listener) => {
      listener(event)
    })
  }

  public clear(): void {
    this.#listeners.clear()
  }
}
