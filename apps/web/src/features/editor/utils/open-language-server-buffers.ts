import type { DocumentKey } from '@/lib/documents/utils/types'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { EditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import type { EditorDocumentStore } from '@/features/editor/state/document-state'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { documentKey } from '@/lib/documents/utils/identity'
import { tabDocuments } from '@/lib/documents/utils/tabs'

export function openLanguageServerBuffers(
  workspace: EditorWorkspaceStore,
  documents: EditorDocumentStore,
): ReadonlyMap<string, EditorTextBuffer> {
  const buffers = new Map<string, EditorTextBuffer>()
  const panels = [
    workspace.workbenchPanels,
    ...Array.from(workspace.parkedWorkspaces.values(), (slice) => slice.workbenchPanels),
  ]
  for (const panel of panels) {
    for (const tab of allEditorTabs(panel.editorGroups)) {
      addTabBuffers(buffers, tabDocuments(tab.content).map(documentKey), documents)
    }
  }
  return buffers
}

function addTabBuffers(
  buffers: Map<string, EditorTextBuffer>,
  keys: readonly DocumentKey[],
  documents: EditorDocumentStore,
): void {
  for (const key of keys) {
    const document = documents.liveDocumentsByKey[key]
    if (document) buffers.set(key, document.buffer)
  }
}
