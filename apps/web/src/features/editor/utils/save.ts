import type {
  EditorDocumentStore,
  LiveEditorDocument,
} from '@/features/editor/state/document-state'
import { saveCapability } from '@/lib/documents/utils/capabilities'
import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'

export function isSavableEditorDocument(document: LiveEditorDocument) {
  const capability = saveCapability(document.target)
  if (capability.kind === 'file') return document.sync.kind === 'file'
  if (capability.kind === 'settings') return document.sync.kind === 'settings'
  return false
}

export function dirtySavableEditorDocuments(
  state: Pick<EditorDocumentStore, 'dirtyDocumentKeys' | 'liveDocumentsByKey'>,
): readonly LiveEditorDocument[] {
  return Object.values(state.liveDocumentsByKey).filter(
    (document) =>
      isSavableEditorDocument(document) && isDirtyLiveEditorDocument(state, document.key),
  )
}

export function isDirtyLiveEditorDocument(
  state: Pick<EditorDocumentStore, 'dirtyDocumentKeys' | 'liveDocumentsByKey'>,
  key: DocumentKey,
) {
  return (
    state.dirtyDocumentKeys.has(key) || state.liveDocumentsByKey[key]?.buffer.isDirty() === true
  )
}

export function filePathsForDocumentKeys(
  state: Pick<EditorDocumentStore, 'liveDocumentsByKey'>,
  keys: readonly DocumentKey[],
): readonly FilesystemPath[] {
  return keys.flatMap((key) => {
    const document = state.liveDocumentsByKey[key]
    return document?.target.kind === 'file' ? [document.target.resource.path] : []
  })
}
