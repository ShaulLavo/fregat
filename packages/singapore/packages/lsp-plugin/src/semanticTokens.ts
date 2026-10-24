import type {
  EditorDisposable,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
  SemanticTokenLayer,
  SemanticTokenLayerController,
  SemanticTokenLayerOptions,
} from '@singapore-editor/core/extensions'
import { createSemanticTokenLayer } from '@singapore-editor/core/extensions'

import type { LanguageServerConnectionContext } from './connectionContext'

/** Which document a layer was created for. A layer never spans two. */
export type LanguageServerSemanticTokensDocument = {
  readonly documentId: string
  readonly languageId: string | null
}

export type LanguageServerSemanticTokensOptions = Omit<SemanticTokenLayerOptions, 'name'> & {
  /** Namespaced within the view. Defaults to `semantic`. */
  readonly name?: string
  /**
   * Receives the layer the view contribution created.
   *
   * A host cannot construct one itself: a layer needs a viewport, a snapshot and a lifecycle, and
   * all three belong to the contribution. Returning a disposable ties the host's own request-side
   * controller to the layer, in the shape `onConnectionCreated` already uses.
   *
   * **A layer never spans two documents or two language ids.** A change to either disposes the one
   * the host is holding and delivers a *new* one through a second call carrying the new identity —
   * so `clear()` across a document change is a call on a dead handle, not a reset.
   */
  onLayer?(
    layer: SemanticTokenLayer,
    document: LanguageServerSemanticTokensDocument,
  ): EditorDisposable | void
}

export type LanguageServerSemanticTokensOwner = {
  readonly id: string
  readonly connection: LanguageServerConnectionContext
}

export type LanguageServerSemanticTokensOwnerOptions = LanguageServerSemanticTokensOptions & {
  dispose?(): void
}

export type LanguageServerSemanticTokensFactory = (
  owner: LanguageServerSemanticTokensOwner,
) => LanguageServerSemanticTokensOwnerOptions

/**
 * Owns the semantic token layer's lifetime on the contribution's behalf.
 *
 * The contribution itself is per *view* and outlives a document change; the contract says a layer
 * does not. So the identity is watched here, and a document or language change tears the layer down
 * and hands the host a fresh one rather than quietly re-pointing the old one at different text.
 */
export class SemanticTokenLayerOwner {
  #layer: SemanticTokenLayerController | null = null
  #registration: EditorDisposable | null = null
  #documentId: string | null = null
  #languageId: string | null = null
  #disposed = false

  public constructor(
    private readonly context: EditorViewContributionContext,
    private readonly options: LanguageServerSemanticTokensOptions,
  ) {}

  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (this.#disposed) return

    const documentId = snapshot.documentId
    if (documentId === null || kind === 'clear') {
      this.#tearDown()
      return
    }
    if (documentId !== this.#documentId || snapshot.languageId !== this.#languageId) {
      this.#tearDown()
      this.#create(documentId, snapshot.languageId)
    }

    this.#layer?.update(snapshot, kind)
  }

  public dispose(): void {
    if (this.#disposed) return

    this.#disposed = true
    this.#tearDown()
  }

  #create(documentId: string, languageId: string | null): void {
    const layer = createSemanticTokenLayer(this.context, {
      name: this.options.name ?? 'semantic',
      onRangeNeeded: this.options.onRangeNeeded,
      onResyncRequired: this.options.onResyncRequired,
      scopeAliases: this.options.scopeAliases,
      viewportDelayMs: this.options.viewportDelayMs,
    })
    this.#layer = layer
    this.#documentId = documentId
    this.#languageId = languageId
    this.#registration = this.options.onLayer?.(layer, { documentId, languageId }) ?? null
  }

  #tearDown(): void {
    this.#registration?.dispose()
    this.#registration = null
    this.#layer?.dispose()
    this.#layer = null
    this.#documentId = null
    this.#languageId = null
  }
}
