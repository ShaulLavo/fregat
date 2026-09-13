import type { FilesystemPath } from '@/lib/documents/utils/types'

import { useEditorUiState } from '@/features/editor/state/ui-state'
import { BreadcrumbsBar } from '@/features/workbench/components/breadcrumbs-bar'
import { CursorBreadcrumbs } from '@/features/workbench/components/cursor-breadcrumbs'

export function EditorBreadcrumbs({
  filePath,
  rootPath,
}: {
  readonly filePath: FilesystemPath
  readonly rootPath: FilesystemPath
}) {
  const statusBarSource = useEditorUiState((state) => state.statusBarSource)
  if (statusBarSource?.filePath !== filePath) {
    return <BreadcrumbsBar cursor={null} filePath={filePath} rootPath={rootPath} />
  }

  return (
    <CursorBreadcrumbs
      controller={statusBarSource.controller}
      filePath={filePath}
      rootPath={rootPath}
    />
  )
}
