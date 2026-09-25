import type { WorkspacePaths } from '../fs/path'
import type {
  ClientOrchestrationCommand,
  OrchestrationCommand,
  WorktreeId,
  OrchestrationWorktree,
} from '@workspace/contracts'
import { GitWorktreeService } from '../git/worktrees'
import type { OrchestrationReadModel } from './read-model'
import { requireProject, requireWorktree } from './read-model'
import { worktreeRuntimeErrors } from './worktree-runtime-errors'
import type { WorktreeExecutionGate } from './worktree-execution-gate'
import type { WorktreeLifecycleReactor } from './worktree-lifecycle-reactor'

type WorktreeCommandPreparationOptions = {
  paths: WorkspacePaths
  git: GitWorktreeService
  gate: WorktreeExecutionGate
  reactor: WorktreeLifecycleReactor
  getReadModel: () => OrchestrationReadModel
}

export class WorktreeCommandPreparation {
  private readonly options: WorktreeCommandPreparationOptions

  constructor(options: WorktreeCommandPreparationOptions) {
    this.options = options
  }

  async withLane<T>(command: ClientOrchestrationCommand, operation: () => Promise<T>): Promise<T> {
    if (command.type === 'worktree.release') return operation()
    const target = creationTarget(command)
    const worktreeId = target?.kind === 'new' ? target.baseWorktreeId : worktreeCommandId(command)
    if (!worktreeId) return operation()
    const worktree = requireWorktree(this.options.getReadModel(), worktreeId)
    if (requireProject(this.options.getReadModel(), worktree.projectId).repositoryKind !== 'git')
      return operation()
    return this.options.git.withRepositoryLane(
      await this.options.reactor.repositoryPath(worktree),
      async () => {
        if (command.type !== 'worktree.resolve-missing') return operation()
        const lease = this.options.gate.tryAcquireExclusive(worktree.id)
        if (!lease.acquired)
          throw worktreeRuntimeErrors.ACTIVE({
            internal: { at: 'resolve-missing', worktreeId: worktree.id, commandType: command.type },
          })
        try {
          return await operation()
        } finally {
          lease.release()
        }
      },
    )
  }

  async prepare(
    command: Exclude<ClientOrchestrationCommand, { type: 'project.create' }>,
    fingerprint: string,
  ): Promise<OrchestrationCommand> {
    const target = creationTarget(command)
    if (
      target?.kind === 'new' &&
      (command.type === 'session.create' || command.type === 'session.turn.start')
    ) {
      const base = requireReady(this.options.getReadModel(), target.baseWorktreeId)
      const project = requireProject(this.options.getReadModel(), base.projectId)
      if (project.repositoryKind !== 'git')
        throw worktreeRuntimeErrors.NOT_GIT({
          internal: {
            projectId: base.projectId,
            repositoryKind: project.repositoryKind,
            baseWorktreeId: base.id,
          },
        })
      const prepared = await this.options.git.prepareCreate({
        path: base.canonicalPath,
        worktreeId: target.worktreeId,
        baseBranch: target.baseBranch,
      })
      const worktreeProvisioning = {
        worktreeId: target.worktreeId,
        baseWorktreeId: target.baseWorktreeId,
        projectId: base.projectId,
        baseCommit: prepared.baseCommit,
        branch: prepared.branch,
        path: this.options.paths.toRealRelative(prepared.absolutePath),
        canonicalPath: prepared.absolutePath,
      }
      return { ...command, worktreeProvisioning, intentFingerprint: fingerprint }
    }
    if (command.type === 'worktree.retain' || command.type === 'worktree.adopt') {
      const worktree = requireWorktree(this.options.getReadModel(), command.worktreeId)
      const observed = await this.options.git.inspect(await this.target(worktree))
      if (!observed.pathExists || !observed.worktree)
        throw worktreeRuntimeErrors.UNAVAILABLE({
          internal: {
            at: command.type,
            worktreeId: command.worktreeId,
            pathExists: observed.pathExists,
            adminExists: observed.adminExists,
          },
        })
      if (command.type === 'worktree.adopt') {
        if (!observed.worktree.commit)
          throw worktreeRuntimeErrors.UNAVAILABLE({
            internal: {
              at: 'adopt',
              worktreeId: command.worktreeId,
              reason: 'no-commit',
              branch: observed.worktree.branch,
            },
          })
        return {
          ...command,
          verified: true,
          branch: observed.worktree.branch,
          headCommit: observed.worktree.commit,
        }
      }
      return { ...command, verified: true }
    }
    if (command.type === 'worktree.resolve-missing') {
      const preview = await this.missingPreview(command.worktreeId)
      if (JSON.stringify(preview.authorization) !== JSON.stringify(command.authorization))
        throw worktreeRuntimeErrors.RECONFIRM({
          internal: {
            worktreeId: command.worktreeId,
            observed: preview.authorization,
            confirmed: command.authorization,
          },
        })
      return { ...command, verified: true }
    }
    return command
  }

  async cleanupPreview(worktreeId: WorktreeId) {
    const worktree = requireWorktree(this.options.getReadModel(), worktreeId)
    if (worktree.ownership !== 'platform')
      throw worktreeRuntimeErrors.UNAVAILABLE({
        internal: { at: 'cleanup-preview', worktreeId, ownership: worktree.ownership },
      })
    const preview = await this.options.git.previewRemoval(await this.target(worktree))
    return {
      worktreeId,
      changedFileCount: preview.changedFileCount,
      authorization: {
        expectedHead: preview.expectedHead,
        expectedStatusFingerprint: preview.expectedStatusFingerprint,
      },
    }
  }

  async missingPreview(worktreeId: WorktreeId) {
    const worktree = requireWorktree(this.options.getReadModel(), worktreeId)
    if (worktree.ownership !== 'platform')
      throw worktreeRuntimeErrors.UNAVAILABLE({
        internal: { at: 'missing-preview', worktreeId, ownership: worktree.ownership },
      })
    if (await this.options.reactor.runtimeBlocker(worktree))
      throw worktreeRuntimeErrors.ACTIVE({
        internal: { at: 'missing-preview', worktreeId, reason: 'runtime-blocker' },
      })
    const observed = await this.options.git.inspect(await this.target(worktree))
    if (observed.pathExists || observed.adminExists)
      throw worktreeRuntimeErrors.UNAVAILABLE({
        internal: {
          at: 'missing-preview',
          worktreeId,
          pathExists: observed.pathExists,
          adminExists: observed.adminExists,
        },
      })
    return {
      worktreeId,
      authorization: {
        canonicalPath: worktree.canonicalPath,
        registrationGeneration: worktree.registrationGeneration,
        pathAbsent: true as const,
        adminAbsent: true as const,
      },
    }
  }

  private async target(worktree: OrchestrationWorktree) {
    return {
      path: await this.options.reactor.repositoryPath(worktree),
      worktreeId: worktree.id,
      worktreePath: worktree.canonicalPath,
      pathKind: worktree.pathKind,
    }
  }
}

function creationTarget(command: ClientOrchestrationCommand) {
  if (command.type === 'session.create') return command.worktreeTarget
  if (command.type === 'session.turn.start') return command.bootstrap?.createSession?.worktreeTarget
  return null
}

function worktreeCommandId(command: ClientOrchestrationCommand) {
  if ('worktreeId' in command) return command.worktreeId
  return null
}

function requireReady(model: OrchestrationReadModel, worktreeId: WorktreeId) {
  const worktree = requireWorktree(model, worktreeId)
  if (worktree.lifecycle.state !== 'ready')
    throw worktreeRuntimeErrors.UNAVAILABLE({
      internal: { at: 'require-ready', worktreeId, lifecycleState: worktree.lifecycle.state },
    })
  return worktree
}
