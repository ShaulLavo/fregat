import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { EditorDisposable } from '@singapore-editor/core/extensions'
import type { LanguageServerConnectionContext } from './connectionContext'
import type { LanguageServerDocumentSyncController } from './documentSyncController'
import { bufferDocumentSnapshot } from './documentSnapshot'
import { DocumentSync } from './documentSync'
import { logicalRevisionScopeFor } from './lane'

/** Gives a connection the same live buffer and edit provenance as a mounted editor. */
export function synchronizeLanguageServerBuffer(
  context: LanguageServerConnectionContext,
  options: {
    readonly buffer: EditorTextBuffer
    readonly uri: string
    readonly languageId: string
    readonly controller?: LanguageServerDocumentSyncController
  },
): EditorDisposable {
  const getSnapshot = () =>
    bufferDocumentSnapshot({ ...options, uri: sync.activeDocument?.uri ?? options.uri })
  const sync = new DocumentSync(
    context.workspace,
    {
      clear() {},
      render() {},
      publishSummary() {},
    },
    { logicalRevisionScope: logicalRevisionScopeFor(context.workspace), onDocumentClosed() {} },
  )
  const registration = options.controller?.register({
    workspace: context.workspace,
    sync,
    getSnapshot,
  })
  sync.sync(getSnapshot(), null)
  const unsubscribe = options.buffer.subscribe(({ change }) => sync.sync(getSnapshot(), change))
  return {
    dispose() {
      unsubscribe()
      registration?.dispose()
      sync.close()
    },
  }
}
