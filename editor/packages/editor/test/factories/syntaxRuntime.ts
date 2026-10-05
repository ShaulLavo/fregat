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
