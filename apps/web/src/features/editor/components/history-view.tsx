import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { HistoryPane } from '@/features/editor/components/history-pane'
import { EditorTabPlaceholder } from '@/features/editor/components/tab-placeholder'
import { useEditorDocumentState } from '@/features/editor/state/document-state'

/** The undo graph of one open file: browse states, compare two, restore one. */
export function HistoryView({
  path,
  tabId,
  onLeave,
}: {
  path: FilesystemPath
  tabId: TabId
  onLeave?: () => void
}) {
  const key = fileDocumentKey(path)
  const buffer = useEditorDocumentState((state) => state.liveDocumentsByKey[key]?.buffer ?? null)

  if (!buffer) {
    return (
      <EditorTabPlaceholder tabId={tabId}>
        <EmptyState className='h-full' title='Open the file to browse its history.' />
      </EditorTabPlaceholder>
    )
  }

  return (
    <HistoryPane
      key={tabId}
      buffer={buffer}
      documentKey={key}
      path={path}
      tabId={tabId}
      onLeave={onLeave}
    />
  )
}
