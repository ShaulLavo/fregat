import {
  synchronizeLanguageServerBuffer,
  type LanguageServerConnectionContext,
  type LanguageServerDocumentSyncController,
} from '@singapore-editor/lsp-plugin'
import type { EditorDisposable } from '@singapore-editor/core/extensions'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { EditorDocumentStoreApi } from './document-state'
import { fileUriForPath } from '@/lib/file-uri'
import { lspLanguageIdForPath } from '@/features/editor/utils/lsp-language-id'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'

export function synchronizeWorkerDocuments(
  connection: LanguageServerConnectionContext,
  options: {
    readonly store: EditorDocumentStoreApi
    readonly ownerKey: string
    readonly controller: LanguageServerDocumentSyncController
    readonly includes: (path: string) => boolean
  },
): EditorDisposable {
  const synced = new Map<string, { buffer: EditorTextBuffer; registration: EditorDisposable }>()
  const reconcile = () => {
    const retained = new Set<string>()
    for (const document of Object.values(options.store.getState().liveDocumentsByKey)) {
      if (document.key === options.ownerKey || document.target.kind !== 'file') continue
      const path = document.target.resource.path
      if (!options.includes(path) || !/\.[cm]?[jt]sx?$/.test(path)) continue
      const languageId = lspLanguageIdForPath(path) ?? languageIdForFilePath(path)
      if (!languageId) continue
      const uri = fileUriForPath(path)
      retained.add(uri)
      if (synced.get(uri)?.buffer === document.buffer) continue
      synced.get(uri)?.registration.dispose()
      synced.set(uri, {
        buffer: document.buffer,
        registration: synchronizeLanguageServerBuffer(connection, {
          buffer: document.buffer,
          uri,
          controller: options.controller,
          languageId,
        }),
      })
    }
    for (const [uri, item] of synced) {
      if (retained.has(uri)) continue
      item.registration.dispose()
      synced.delete(uri)
    }
  }
  // DocumentSync streams buffer revisions into the same LSP workspace and provenance ledger.
  reconcile()
  const unsubscribe = options.store.subscribe(reconcile)
  return {
    dispose() {
      unsubscribe()
      for (const item of synced.values()) item.registration.dispose()
      synced.clear()
    },
  }
}
