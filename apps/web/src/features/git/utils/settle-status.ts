import type { QueryClient } from '@tanstack/react-query'
import type { GitStatusResult } from '@workspace/contracts'

import { fileSystemKeys, gitKeys } from '@/lib/query-keys'

/**
 * Seeds the status a git write already returned. `rootPath` is the caller's key,
 * not `status.repository.path`: a workspace opened below the repo root reads a
 * different string, and a seed nothing observes would never reach the panel.
 */
export function settleGitStatus(client: QueryClient, rootPath: string, status: GitStatusResult) {
  client.setQueryData<GitStatusResult>(gitKeys.status(rootPath), status)
  void client.invalidateQueries({ queryKey: gitKeys.diffs() })
}

/** Discard rewrites files on disk; stage and unstage never leave the index. */
export function settleDiscardedGitStatus(
  client: QueryClient,
  rootPath: string,
  status: GitStatusResult,
) {
  settleGitStatus(client, rootPath, status)
  void client.invalidateQueries({ queryKey: fileSystemKeys.fileSnapshots() })
  void client.invalidateQueries({ queryKey: fileSystemKeys.trees() })
}
