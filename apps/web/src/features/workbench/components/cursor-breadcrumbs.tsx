import type { ReactEditorController } from '@singapore-editor/react'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import { BreadcrumbsBar } from '@/features/workbench/components/breadcrumbs-bar'
import { useEditorSymbolChain } from '@/features/workbench/hooks/use-editor-symbol-chain'
import type { DocumentSymbol } from '@/lib/document-symbols'

export function CursorBreadcrumbs({
  controller,
  symbols,
  filePath,
  rootPath,
}: {
  readonly controller: ReactEditorController
  readonly symbols: readonly DocumentSymbol[]
  readonly filePath: FilesystemPath
  readonly rootPath: FilesystemPath
}) {
  const symbolChain = useEditorSymbolChain(controller, symbols)

  return (
    <BreadcrumbsBar
      controller={controller}
      symbols={symbols}
      symbolChain={symbolChain}
      filePath={filePath}
      rootPath={rootPath}
    />
  )
}
