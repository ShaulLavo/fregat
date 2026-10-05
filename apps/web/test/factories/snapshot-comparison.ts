import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client } from '@/lib/client'
import { fetchDiff } from '@/lib/git-diff-query'
import { fetchBlobDiff } from '@/lib/blob-diff-query'
import {
  snapshotDocument,
  historicalDocument,
  comparisonRequest,
} from '@/lib/documents/utils/comparisons'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import { createClientInvariantError } from '@/lib/structured-errors'
import { runGit } from './git'
import { testScopedStorage } from './scoped-storage'

export async function createSnapshotComparisonFixture(root: string, client: Client) {
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'])
  runGit(repo, ['config', 'user.email', 'test@example.com'])
  runGit(repo, ['config', 'user.name', 'Test'])
  const path = filesystemPath('repo/source.ts')
  await writeFile(join(root, path), 'export const authority = "COMMIT"\n')
  runGit(repo, ['add', '.'])
  runGit(repo, ['commit', '-m', 'base'])
  await writeFile(join(root, path), 'export const authority = "INDEX"\n')
  runGit(repo, ['add', '.'])
  const [staged] = await fetchDiff(path, true, undefined, client)
  await writeFile(join(root, path), 'export const authority = "DISK"\n')
  const [worktree] = await fetchDiff(path, false, undefined, client)
  if (!staged || !worktree)
    throw createClientInvariantError('Git source fixture requires two diffs')
  const scope = { environmentId: testScopedStorage.environmentId, rootPath: filesystemPath('repo') }
  const stageDocument = snapshotDocument(staged, scope.rootPath, 'staged')
  const workDocument = snapshotDocument(worktree, scope.rootPath, 'worktree')
  if (
    !stageDocument ||
    !workDocument ||
    stageDocument.source.kind !== 'snapshot' ||
    workDocument.source.kind !== 'snapshot'
  )
    throw createClientInvariantError('Git source fixture requires resolved objects')
  const parent = runGit(repo, ['rev-parse', 'HEAD']).stdout.trim()
  const tree = runGit(repo, ['write-tree']).stdout.trim()
  const commit = runGit(repo, [
    'commit-tree',
    tree,
    '-p',
    parent,
    '-m',
    'Captured historical index',
  ]).stdout.trim()
  const response = await client.git.history.commit.get({ query: { path: scope.rootPath, commit } })
  const details = response.data
  const file = details?.files.find((entry) => entry.path === path)
  const document =
    details && file ? historicalDocument({ rootPath: scope.rootPath, details, file }) : null
  if (!document || document.source.kind !== 'snapshot')
    throw createClientInvariantError('Git source fixture requires actual commit details')
  const historical = document.source
  const request = comparisonRequest(historical)
  if (request.kind !== 'snapshot')
    throw createClientInvariantError('Git source fixture requires a fixed historical pair')
  const historicalDiffs = await fetchBlobDiff(request.query, undefined, client)
  return {
    scope,
    path,
    staged,
    worktree,
    historicalDiffs,
    comparison: workDocument.source,
    input: snapshotComparisonInput({ scope, comparison: workDocument.source, diffs: [worktree] }),
    stagedInput: snapshotComparisonInput({
      scope,
      comparison: stageDocument.source,
      diffs: [staged],
    }),
    historicalInput: snapshotComparisonInput({
      scope,
      comparison: historical,
      diffs: historicalDiffs,
    }),
  }
}
