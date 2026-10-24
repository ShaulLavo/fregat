import { createEditorStructuralOperation } from '../../src/editor/operationDefinitions'
import type { EditorStructuralOperationContext } from '../../src/document/operations'
import type { EditorPlugin } from '../../src/plugins'

import { createEmptySyntaxResult, type EditorSyntaxRuntime } from '../../src/syntax/session'

export function createEmptySyntaxRuntime(): EditorSyntaxRuntime {
  return {
    analyze: async () => createEmptySyntaxResult(),
    foldingSupport: 'unsupported',
    getResult: createEmptySyntaxResult,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose: () => {},
  }
}

export function createSyntaxPlugin(
  open: (context: EditorStructuralOperationContext) => EditorSyntaxRuntime | null,
): EditorPlugin {
  const operation = createEditorStructuralOperation(open)
  return { activate: (context) => context.registerSyntaxProvider({ operation }) }
}
