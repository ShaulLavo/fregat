import { CompareSavedLoading } from '@/features/editor/components/compare-saved-loading'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { createTextDiff } from '@singapore-editor/diff'
import { EmptyState } from '@workspace/ui/components/empty-state'
import {} from 'react'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { EditorTabPlaceholder } from '@/features/editor/components/tab-placeholder'
import { useDiffLanguageContext } from '@/features/editor/hooks/use-diff-language-context'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import type { DiffLanguageHost } from '@/features/editor/utils/diff-language-context'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import { useSettingValue } from '@/hooks/use-setting-value'

/**
 * Diffs the active buffer against the file on disk — VS Code's "Compare Active File with Saved".
 *
 * Both sides are read live rather than snapshotted when the tab opened: the saved side comes from
 * the file cache and the working side from the live buffer, so the diff keeps answering "what have
 * I changed" as you keep typing.
 */
export function CompareSavedView({
  languageHost,
  path,
  rootPath,
  tabId,
}: {
  languageHost: DiffLanguageHost
  path: FilesystemPath
  rootPath: FilesystemPath
  tabId?: TabId
}) {
  const key = fileDocumentKey(path)
  const mode = useSettingValue('editor.diff.viewMode')
  const { fileState } = useSelectedFile(path)
  const buffer = useEditorDocumentState((state) => state.liveDocumentsByKey[key]?.buffer ?? null)
  // Revision, not the buffer object: the buffer is mutated in place, so its identity never changes
  // and would never re-run the diff.
  const revision = useEditorDocumentState((state) => state.documentContentRevisions[key] ?? '')
  // Its new side IS the live buffer, so it is by construction the text the owning editor sent the
  // server — the file's own uri names exactly this text, and joining it is a no-op on the wire.
  const languageServer = useDiffLanguageContext(path, rootPath, true, languageHost)

  const savedText = fileState.status === 'ready' ? fileState.data.content : null
  // Keep the text tied to the revision that materialized it. The mutable buffer object does not
  // change identity as edits arrive.
  const snapshot = { revision, text: buffer?.materializeFullText() ?? null }
  const file = savedTextDiff(path, savedText, snapshot.text)

  // No retry: closing and reopening the compare tab re-reads the saved file.
  if (fileState.status === 'error') {
    return (
      <EditorTabPlaceholder tabId={tabId}>
        <EmptyState className='h-full' title='Could not read the saved file.' tone='error' />
      </EditorTabPlaceholder>
    )
  }
  if (fileState.status === 'loading') {
    return <CompareSavedLoading />
  }
  if (!file) {
    if (buffer) return <DiffEditor file={null} mode={mode} tabId={tabId} />

    return (
      <EditorTabPlaceholder tabId={tabId}>
        <EmptyState className='h-full' title='Open the file to compare it with disk.' />
      </EditorTabPlaceholder>
    )
  }
  if (file.hunks.length === 0)
    return (
      <EditorTabPlaceholder tabId={tabId}>
        <EmptyState className='h-full' title='No unsaved changes.' />
      </EditorTabPlaceholder>
    )

  return <DiffEditor file={file} languageServer={languageServer} mode={mode} tabId={tabId} />
}

function savedTextDiff(path: FilesystemPath, savedText: string | null, text: string | null) {
  if (savedText === null || text === null) return null

  const languageId = languageIdForFilePath(path)
  return createTextDiff({
    newFile: { languageId, path, text },
    oldFile: { languageId, path, text: savedText },
  })
}
