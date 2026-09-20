import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'
import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import type { DocumentKey } from '@/lib/documents/utils/types'

export function editorTabCloseTargets(
  tabs: readonly EditorTabModel[],
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
): EditorTabCloseTarget[] {
  return tabs.map((tab) => ({
    dirty: isEditorTabDirty(tab.content, dirtyDocumentKeys),
    id: tab.id,
  }))
}
