import { createEditorStructuralOperation } from '@singapore-editor/core/editor'
import {
  createEmptySyntaxResult,
  type EditorSyntaxProvider,
  type EditorSyntaxRuntime,
} from '@singapore-editor/core/syntax'

export function createRetentionSyntaxRuntime(): EditorSyntaxRuntime {
  let result = createEmptySyntaxResult()
  return {
    analyze: async (read) => {
      result = createEmptySyntaxResult({ snapshot: { length: read.text.length } })
      return result
    },
    getResult: () => result,
    getTokens: () => result.tokens,
    getSnapshotVersion: () => 0,
    foldingSupport: 'supported',
    dispose: () => {},
  }
}
export function retentionProvider(onDispose: () => void): EditorSyntaxProvider {
  return {
    operation: createEditorStructuralOperation(() => {
      const runtime = createRetentionSyntaxRuntime()
      return {
        ...runtime,
        dispose: () => {
          runtime.dispose()
          onDispose()
        },
      }
    }),
  }
}
