import type { QueryClient } from '@tanstack/react-query'
import type { GitStatusResult } from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { gitKeys } from '@/lib/query-keys'
import { fetchStatus } from '@/features/git/utils/api'

/** Every git write: a read-only environment refuses it before anything runs. */
export function admitGitWrite(owner: QueryClient) {
  assertEnvironmentWritable(originForQueryClient(owner))
}

/**
 * Discard destroys work, so it runs only against the changes on screen. Stage, unstage
 * and commit are recoverable and skip this fresh status read, as VS Code does.
 */
export async function admitDiscard(owner: QueryClient, rootPath: string, paths: readonly string[]) {
  admitGitWrite(owner)
  const expected = owner.getQueryData<GitStatusResult>(gitKeys.status(rootPath))
  await owner.cancelQueries({ queryKey: gitKeys.status(rootPath), exact: true })
  const status = await owner.fetchQuery({
    queryKey: gitKeys.status(rootPath),
    queryFn: ({ signal }) => fetchStatus(rootPath, signal, clientForQueryClient(owner), true),
    staleTime: 0,
  })
  if (expected && statusIdentity(expected, paths) !== statusIdentity(status, paths))
    throw changedStatus()
  admitGitWrite(owner)
  return status
}

/** An index write that deletes from disk is admitted as a discard. */
export async function admitIndexWrite(
  owner: QueryClient,
  rootPath: string,
  discards: readonly string[] | undefined,
) {
  if (discards) return admitDiscard(owner, rootPath, discards)
  admitGitWrite(owner)
}

function statusIdentity(status: GitStatusResult, paths: readonly string[]) {
  const selected = new Set(paths)
  return JSON.stringify({
    repository: status.repository,
    files: status.files
      .filter((file) => selected.has(file.path))
      .toSorted((a, b) => a.path.localeCompare(b.path)),
  })
}

function changedStatus() {
  return createClientError({
    code: 'git-status-changed',
    status: 409,
    message: 'The repository needs another review before this action.',
    why: 'The displayed changes are not the current confirmed repository state.',
    fix: 'Review the refreshed changes, then try the action again.',
  })
}
