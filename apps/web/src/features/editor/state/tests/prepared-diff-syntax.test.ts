import { createEmptySyntaxResult } from '@singapore-editor/core/syntax'
import { createTextDiff, prepareDiffSyntax, type DiffSyntaxBackend } from '@singapore-editor/diff'
import { QueryClient } from '@tanstack/react-query'
import {
  claimPreparedDiffSyntax,
  clearPreparedDiffSyntax,
  diffSyntaxPreparationKey,
  hasPreparedDiffSyntax,
  storePreparedDiffSyntax,
} from '@/features/editor/state/prepared-diff-syntax'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { runMutation } from '@/lib/mutations/run'
import { expect, test } from '../../../../../test/fixtures'

const SOURCE = 'tree-sitter'

for (const current of [true, false]) {
  test(`a claim awaits the running preparation and ${current ? 'takes it' : 'leaves it stored once the view has left'}`, async () => {
    const queryClient = new QueryClient()
    const file = diff()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const preparing = runMutation(
      queryClient,
      {
        mutationKey: editorMutationKeys.diffSyntaxPrepare(),
        mutationFn: async (_key: string) => {
          await gate
          storePreparedDiffSyntax(file, SOURCE, await prepareDiffSyntax(file, { backend }))
        },
      },
      diffSyntaxPreparationKey(file, SOURCE),
    )
    try {
      const claim = claimPreparedDiffSyntax(queryClient, diff(), 'stacked', SOURCE, () => current)
      expect(claim).toBeInstanceOf(Promise)
      release()
      await preparing

      expect(await claim).toHaveLength(current ? 2 : 0)
      expect(hasPreparedDiffSyntax(file, SOURCE)).toBe(!current)
    } finally {
      clearPreparedDiffSyntax(SOURCE)
      queryClient.clear()
    }
  })
}

function diff() {
  return createTextDiff({
    newFile: { languageId: 'typescript', path: 'repo/a.ts', text: 'const b = 2\n' },
    oldFile: { languageId: 'typescript', path: 'repo/a.ts', text: 'const a = 1\n' },
  })
}

const backend = {
  kind: 'tree-sitter',
  provider: {
    createSession: () => {
      const result = () => ({ ...createEmptySyntaxResult(), tokens: [] })
      return {
        foldingSupport: 'supported',
        applyChange: async () => result(),
        dispose: () => undefined,
        getResult: result,
        getSnapshotVersion: () => 0,
        getTokens: () => [],
        refresh: async () => result(),
      }
    },
  },
} as DiffSyntaxBackend
