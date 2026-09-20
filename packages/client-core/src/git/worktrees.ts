import type { GitWorktree } from '@workspace/contracts'
import type { Client } from '../transport/client'
import { createRpcError } from '../transport/rpc-error'

export async function listGitWorktrees({
  client,
  path,
  signal,
}: {
  readonly client: Client
  readonly path: string
  readonly signal: AbortSignal
}): Promise<readonly GitWorktree[]> {
  const { data, error } = await client.git.worktrees.get({ query: { path }, fetch: { signal } })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return data
}
