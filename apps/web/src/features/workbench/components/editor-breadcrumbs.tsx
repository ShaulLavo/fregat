import type { FilesystemPath } from '@/lib/documents/utils/types'

import { useEditorUiState } from '@/features/editor/state/ui-state'
import { BreadcrumbsBar } from '@/features/workbench/components/breadcrumbs-bar'
import { CursorBreadcrumbs } from '@/features/workbench/components/cursor-breadcrumbs'
import { useDocumentSymbolTree } from '@/features/workbench/hooks/use-document-symbol-tree'
import { EMPTY_SYMBOL_CHAIN } from '@/features/workbench/utils/breadcrumbs'

export function EditorBreadcrumbs({
  filePath,
  rootPath,
}: {
  readonly filePath: FilesystemPath
  readonly rootPath: FilesystemPath
}) {
  const symbols = useDocumentSymbolTree(rootPath, filePath)
  const statusBarSource = useEditorUiState((state) => state.statusBarSource)
  if (statusBarSource?.filePath !== filePath) {
    return (
      <BreadcrumbsBar
        controller={null}
        symbols={symbols}
        symbolChain={EMPTY_SYMBOL_CHAIN}
        filePath={filePath}
        rootPath={rootPath}
      />
    )
  }

  return (
    <CursorBreadcrumbs
      controller={statusBarSource.controller}
      symbols={symbols}
      filePath={filePath}
      rootPath={rootPath}
    />
  )
}
