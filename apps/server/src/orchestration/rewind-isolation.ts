import { realpath } from 'node:fs/promises'
import { isSameOrDescendant } from '../fs/path'
import type { SessionId } from '@workspace/contracts'
import { gitCommonDirectory } from '../git/repository-lane'
import type { GitService } from '../git/service'
import type { ProviderRuntimeBindingWithMetadata } from '../provider/provider-session-directory'
import type { OrchestrationReadModel } from './read-model'
import { resolveSessionOwner } from './session-owner'
import { checkpointErrors } from './structured-errors'

export async function assertRewindIsolation({
  sessionId,
  model,
  git,
  activeRuntimes,
}: {
  readonly sessionId: SessionId
  readonly model: OrchestrationReadModel
  readonly git: GitService
  readonly activeRuntimes: readonly ProviderRuntimeBindingWithMetadata[]
}) {
  const { worktree } = resolveSessionOwner(model, sessionId)
  if (worktree.kind !== 'linked' || worktree.lifecycle.state !== 'ready')
    throw checkpointErrors.WORKSPACE_NOT_ISOLATED({
      internal: {
        check: 'worktree-kind',
        worktreeId: worktree.id,
        kind: worktree.kind,
        lifecycleState: worktree.lifecycle.state,
      },
    })
  const cwd = await realpath(worktree.canonicalPath)
  const repository = await git.repositoryRunner(cwd)
  if ((await realpath(repository.rootAbsolutePath)) !== cwd)
    throw checkpointErrors.WORKSPACE_NOT_ISOLATED({
      internal: { check: 'repository-root', worktreeId: worktree.id },
    })
  const gitDir = await repository.run(['rev-parse', '--absolute-git-dir'])
  if ((await realpath(gitDir.stdout.trim())) === (await gitCommonDirectory(repository)))
    throw checkpointErrors.WORKSPACE_NOT_ISOLATED({
      internal: { check: 'shared-git-dir', worktreeId: worktree.id },
    })
  const candidates = new Set<string>()
  for (const other of model.sessions.values()) {
    if (other.id === sessionId || other.deletedAt) continue
    const owner = model.worktrees.get(other.worktreeId)
    if (owner) candidates.add(owner.canonicalPath)
  }
  for (const runtime of activeRuntimes) {
    if (runtime.sessionId === sessionId || !runtime.runtimePayload?.cwd) continue
    candidates.add(runtime.runtimePayload.cwd)
  }
  for (const candidate of candidates) {
    const other = await existingRealPath(candidate)
    if (other && (isSameOrDescendant(cwd, other) || isSameOrDescendant(other, cwd)))
      throw checkpointErrors.WORKSPACE_NOT_ISOLATED({
        internal: { check: 'overlapping-runtime', candidateCount: candidates.size },
      })
  }
}

async function existingRealPath(candidate: string) {
  try {
    return await realpath(candidate)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
}
