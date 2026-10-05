import { savedDiffAttachment } from '@/lib/diff-attachment'
import { CompareSavedLoading } from '@/features/editor/components/compare-saved-loading'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { EditorTabPlaceholder } from '@/features/editor/components/tab-placeholder'
import { useDiffLanguageContext } from '@/features/editor/hooks/use-diff-language-context'
import { useSavedComparison } from '@/features/editor/hooks/use-saved-comparison'
import type { DiffLanguageHost } from '@/features/editor/utils/diff-language-context'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import { useSettingValue } from '@/hooks/use-setting-value'

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
  const mode = useSettingValue('editor.diff.viewMode')
  const { fileState } = useSelectedFile(path)
  const saved = fileState.status === 'ready' && !fileState.data.seemsBinary ? fileState.data : null
  const { read } = useSavedComparison(rootPath, saved, tabId)
  const sourcePath = read?.kind === 'ready' ? read.saved.snapshot.path : path
  const sourceRoot = read?.kind === 'ready' ? read.scope.rootPath : rootPath
  const languageServer = useDiffLanguageContext(sourcePath, sourceRoot, true, languageHost)
  const attachment = read?.kind === 'ready' ? savedDiffAttachment(read) : null
  const file = attachment?.file ?? null

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
  if (fileState.status === 'ready' && fileState.data.seemsBinary) {
    return (
      <EmptyState
        className='h-full'
        title='Binary file'
        description='Open the file to view its details.'
      />
    )
  }
  if (!file || !attachment) {
    if (saved && !read) return <CompareSavedLoading />

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

  return (
    <DiffEditor attachment={attachment} languageServer={languageServer} mode={mode} tabId={tabId} />
  )
}
