import type { LanguageServerDocumentSnapshot } from './types'
import type { DocumentSyncPoint } from '@singapore-editor/core/document'
import type { EditorDisposable } from '@singapore-editor/core/extensions'
import type * as lsp from 'vscode-languageserver-protocol'

import type { DocumentSync } from './documentSync'

export type LanguageServerDocumentUriTransition = {
  readonly fromUri: lsp.DocumentUri
  readonly toUri: lsp.DocumentUri
  readonly previousSyncPoint: DocumentSyncPoint
  readonly syncPoint: DocumentSyncPoint
}

export type LanguageServerDocumentSyncControllerRegistration = {
  readonly getSnapshot: () => LanguageServerDocumentSnapshot
  readonly sync: DocumentSync
}

/**
 * Projects a live document identity change through every mounted language-server lane immediately.
 */
export class LanguageServerDocumentSyncController {
  private readonly registrations = new Set<LanguageServerDocumentSyncControllerRegistration>()

  public register(
    registration: LanguageServerDocumentSyncControllerRegistration,
  ): EditorDisposable {
    this.registrations.add(registration)
    return {
      dispose: () => this.registrations.delete(registration),
    }
  }

  public transitionDocumentUri(transition: LanguageServerDocumentUriTransition): void {
    for (const registration of this.registrations) {
      registration.sync.transitionDocumentUri(registration.getSnapshot(), transition)
    }
  }
}
