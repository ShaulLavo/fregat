import type { GitFileDiff } from '@workspace/contracts'
import { act, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { useDiffDocumentDiffs } from '@/features/git/hooks/use-diff-document-diffs'
import { fetchDiff } from '@/features/git/utils/api'
import { blobDiffQueryKey } from '@/features/git/utils/blob-diff-query'
import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import type { Client } from '@/lib/client'
import { fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import type { GitComparison } from '@/lib/documents/utils/types'
import { TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'

test('a blob answer for the previously displayed entry never lands on the next one', async ({
  client,
  server,
}) => {
  const [first, second] = await twoEntries(server.root, client)
  const queryClient = createTestQueryClient()
  const comparisons = { first: comparisonFor(first), second: comparisonFor(second) }
  queryClient.setQueryData(diffDocumentQueryKey(comparisons.first), [first])
  queryClient.setQueryData(diffDocumentQueryKey(comparisons.second), [second])

  const { result, rerender } = renderHookWithProviders(
    ({ comparison }: { comparison: GitComparison }) => useDiffDocumentDiffs(comparison),
    { initialProps: { comparison: comparisons.first }, queryClient },
  )
  rerender({ comparison: comparisons.second })
  await waitFor(() => expect(result.current.pending).toBe(false))
  // The first entry's request settles late, with an answer only it asked for.
  act(() => {
    queryClient.setQueryData(blobDiffQueryKey(blobRequest(first)), [
      { ...first, newText: 'late\n', oldText: 'late\n' },
    ])
  })

  expect(result.current.diffs).toHaveLength(1)
  expect(result.current.diffs[0]?.path).toBe(second.path)
  expect(result.current.diffs[0]?.newText).toBe('second edited\n')
  expect(result.current.diffs[0]?.oldText).toBe('second\n')
})

function blobRequest(diff: GitFileDiff) {
  return {
    newObjectId: diff.newObjectId,
    oldObjectId: diff.oldObjectId,
    oldPath: diff.oldPath,
    path: diff.path,
  }
}

function comparisonFor(diff: GitFileDiff): GitComparison {
  return {
    file: fileResource(filesystemPath(diff.path)),
    fromTurnCount: 0,
    kind: 'checkpoint-file',
    owner: filesystemPath('repo'),
    sessionId: TEST_SESSION_ID,
    toTurnCount: 1,
  }
}

/** Worktree diffs of two edited files, then working copies the hook must never read. */
async function twoEntries(root: string, client: Client) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  for (const name of ['first', 'second'])
    await writeFile(path.join(repo, `${name}.ts`), `${name}\n`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'init')

  const entries: GitFileDiff[] = []
  for (const name of ['first', 'second']) {
    await writeFile(path.join(repo, `${name}.ts`), `${name} edited\n`)
    const [entry] = await fetchDiff(`repo/${name}.ts`, false, undefined, client)
    entries.push(entry!)
    await writeFile(path.join(repo, `${name}.ts`), 'unrelated working copy\n')
  }

  return entries as [GitFileDiff, GitFileDiff]
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}
