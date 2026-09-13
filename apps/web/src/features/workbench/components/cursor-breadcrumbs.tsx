import type { ReactEditorController } from '@singapore-editor/react'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import { BreadcrumbsBar } from '@/features/workbench/components/breadcrumbs-bar'
import { useEditorCursor } from '@/features/workbench/hooks/use-editor-cursor'

export function CursorBreadcrumbs({
  controller,
  filePath,
  rootPath,
}: {
  readonly controller: ReactEditorController
  readonly filePath: FilesystemPath
  readonly rootPath: FilesystemPath
}) {
  const cursor = useEditorCursor(controller)

  return (
    <BreadcrumbsBar
      cursor={cursor}
      filePath={filePath}
      rootPath={rootPath}
      onFocusEditor={() => controller.commands.focus()}
    />
  )
}
