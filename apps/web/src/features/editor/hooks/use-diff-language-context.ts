import { useDocumentFeatureTier } from '@/features/editor/hooks/use-document-feature-tier'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { workspaceDocumentPath } from '@/features/editor/utils/diff-language-context'

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
  const textSnapshot = useEditorDocumentState((state) =>
    key ? (state.liveDocumentsByKey[key]?.buffer.getTextSnapshot() ?? null) : null,
  )
  const { analysisAllowed } = useDocumentFeatureTier(buffer)
  const ownedText = analysisAllowed ? (textSnapshot?.materializeFullText() ?? null) : null

  if (!path || !analysisAllowed) return null

  return {
    documentPath,
    host,
    newSideIsWorkingTree,
    ownedText,
    rootPath,
  }
}
