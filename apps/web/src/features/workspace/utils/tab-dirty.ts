import { documentKey } from '@/lib/documents/utils/identity'
import { tabDocuments } from '@/lib/documents/utils/tabs'
import type { DocumentKey, TabContent } from '@/lib/documents/utils/types'

/** Whether a tab has unsaved text in any of the documents behind it. */
export function isEditorTabDirty(content: TabContent, dirtyKeys: ReadonlySet<DocumentKey>) {
  return tabDocuments(content).some((document) => dirtyKeys.has(documentKey(document)))
}
