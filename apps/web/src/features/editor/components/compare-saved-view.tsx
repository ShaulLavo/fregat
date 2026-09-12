import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { createTextDiff } from '@singapor/diff'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useMemo } from 'react'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { useDiffLanguageContext } from '@/features/editor/hooks/use-diff-language-context'
import { useEditorDocumentState } from '@/features/editor/state/document-state'
import type { DiffLanguageHost } from '@/features/editor/utils/diff-language-context'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'

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
  const snapshot = useMemo(
    () => ({ revision, text: buffer?.materializeFullText() ?? null }),
    [buffer, revision],
  )
  const file = useMemo(() => {
    if (savedText === null || snapshot.text === null) return null

    const languageId = languageIdForFilePath(path)
    return createTextDiff({
      newFile: { languageId, path, text: snapshot.text },
      oldFile: { languageId, path, text: savedText },
    })
  }, [path, savedText, snapshot])

  if (fileState.status === 'error') {
    return <CompareNotice message='Could not read the saved file.' tone='error' />
  }
  if (fileState.status === 'loading') {
    return (
      <LoadingState className='flex h-full flex-col gap-3 p-4' label='Loading saved file'>
        <div className='bg-muted h-4 w-3/4 rounded' />
        <div className='bg-muted h-4 w-1/2 rounded' />
        <div className='bg-muted h-4 w-2/3 rounded' />
      </LoadingState>
    )
  }
  if (!file) {
    if (buffer) return <DiffEditor file={null} mode={mode} tabId={tabId} />

    return <CompareNotice message='Open the file to compare it with disk.' />
  }
  if (file.hunks.length === 0) return <CompareNotice message='No unsaved changes.' />

  return <DiffEditor file={file} languageServer={languageServer} mode={mode} tabId={tabId} />
}

function CompareNotice({ message, tone }: { message: string; tone?: 'error' }) {
  return (
    <div
      className={
        tone === 'error'
          ? 'text-destructive flex h-full items-center justify-center p-4 text-sm'
          : 'text-muted-foreground flex h-full items-center justify-center p-4 text-sm'
      }
    >
      {message}
    </div>
  )
}
