import type { QueryClient } from '@tanstack/react-query'
import type { GitStatusResult } from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { gitKeys } from '@/lib/query-keys'
import { fetchStatus } from '@/features/git/utils/api'
import { savedGit } from '@/features/git/state/reload'

export async function admitGitMutation(
  owner: QueryClient,
  rootPath: string,
  paths?: readonly string[],
) {
  assertEnvironmentWritable(originForQueryClient(owner))
  const expected = owner.getQueryData<GitStatusResult>(gitKeys.status(rootPath))
  if (!expected && savedGit(owner, rootPath)?.status) throw changedStatus('unconfirmed')
  await owner.cancelQueries({ queryKey: gitKeys.status(rootPath), exact: true })
  const status = await owner.fetchQuery({
    queryKey: gitKeys.status(rootPath),
    queryFn: ({ signal }) => fetchStatus(rootPath, signal, clientForQueryClient(owner), true),
    staleTime: 0,
  })
  if (expected && statusIdentity(expected, paths) !== statusIdentity(status, paths))
    throw changedStatus('changed')
  assertEnvironmentWritable(originForQueryClient(owner))
  return status
}

function statusIdentity(status: GitStatusResult, paths?: readonly string[]) {
  const selected = paths ? new Set(paths) : null
  return JSON.stringify({
    repository: status.repository,
    files: status.files
      .filter((file) => !selected || selected.has(file.path))
      .toSorted((a, b) => a.path.localeCompare(b.path)),
  })
}

function changedStatus(reason: 'unconfirmed' | 'changed') {
  return createClientError({
    code: 'git-status-changed',
    status: 409,
    message: 'The repository needs another review before this action.',
    why: 'The displayed changes are not the current confirmed repository state.',
    fix: 'Review the refreshed changes, then try the action again.',
    internal: { reason },
  })
}
