import { useEditorSelector, type ReactEditorController } from '@singapore-editor/react'

import { symbolChainAtCursor, symbolChainsEqual } from '@/features/workbench/utils/breadcrumbs'
import type { DocumentSymbol } from '@/lib/document-symbols'

export function useEditorSymbolChain(
  controller: ReactEditorController,
  symbols: readonly DocumentSymbol[],
): readonly DocumentSymbol[] {
  return useEditorSelector(
    controller,
    (snapshot) => symbolChainAtCursor(symbols, snapshot.state?.cursor ?? null),
    symbolChainsEqual,
  )
}
