import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { workspaceDocumentPath } from '@/features/editor/utils/diff-language-context'
import {} from 'react'

import { useEditorDocumentState } from '@/features/editor/state/document-state'
import type {
  DiffLanguageHost,
  DiffLanguageServerContext,
} from '@/features/editor/utils/diff-language-context'

/** Platform-owned live text and host capabilities for a reusable diff editor. */
export function useDiffLanguageContext(
  path: FilesystemPath | null,
  rootPath: FilesystemPath,
  newSideIsWorkingTree: boolean,
  host: DiffLanguageHost,
): DiffLanguageServerContext | null {
  const documentPath = path ? workspaceDocumentPath(rootPath, path) : null
  const key = documentPath ? fileDocumentKey(documentPath) : null
  const buffer = useEditorDocumentState((state) =>
    key ? (state.liveDocumentsByKey[key]?.buffer ?? null) : null,
  )
  // The buffer mutates in place, so its identity cannot invalidate materialized text.
  const revision = useEditorDocumentState((state) =>
    key ? (state.documentContentRevisions[key] ?? '') : '',
  )
  const snapshot = { revision, text: buffer?.materializeFullText() ?? null }

  if (!path) return null

  return {
    documentPath,
    host,
    newSideIsWorkingTree,
    ownedText: snapshot.text,
    rootPath,
  }
}
