import type { LanguageServerDocumentSnapshot } from './types'
import type { DocumentSyncPoint, TextSnapshot } from '@singapore-editor/core/document'
import type { EditorDisposable } from '@singapore-editor/core/extensions'
import type { LspWorkspace } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import type { DocumentSync } from './documentSync'

export type LanguageServerDocumentUriTransition = {
  readonly fromUri: lsp.DocumentUri
  readonly toUri: lsp.DocumentUri
  readonly textSnapshot: TextSnapshot
  readonly syncPoint: DocumentSyncPoint
}

export type LanguageServerDocumentSyncControllerRegistration = {
  readonly getSnapshot: () => LanguageServerDocumentSnapshot
  readonly sync: DocumentSync
  readonly workspace: LspWorkspace
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
    const transitionedWorkspaces = new Set<LspWorkspace>()
    for (const registration of this.registrations) {
      if (transitionedWorkspaces.has(registration.workspace)) continue

      const handled = registration.sync.transitionDocumentUri(
        registration.getSnapshot(),
        transition,
      )
      if (!handled) continue
      if (registration.sync.activeDocument?.uri !== transition.toUri) continue
      transitionedWorkspaces.add(registration.workspace)
    }
  }
}
