import type { WorkspacePaths } from '../fs/path'
import * as v from 'valibot'
import path from 'node:path'
import { lstat } from 'node:fs/promises'
import {
  commandIdSchema,
  worktreeIdSchema,
  type CommandId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type WorktreeId,
  type OrchestrationProjectScript,
  type OrchestrationWorktree,
  type WorktreeSetup,
  type WorktreeSubmoduleMode,
} from '@workspace/contracts'
import { outsideGitRepositoryLane } from '../git/repository-lane'
import { GitWorktreeService } from '../git/worktrees'
import { gitWorktreeErrors } from '../git/utils/worktree-errors'
import type { ProviderService } from '../provider/provider-service'
import type { TerminalService } from '../terminal/service'
import { recordProcessInfo, recordProcessWarning } from '../observability'
import { internalCommandKey } from './utils/repository-ids'
import { requireWorktree, type OrchestrationReadModel } from './read-model'
import { worktreeRuntimeErrors } from './worktree-runtime-errors'
import type { WorktreeExecutionGate } from './worktree-execution-gate'
import { SetupRunner } from './setup-runner'
import { setupScript } from './utils/setup-script'

type Cleanup = Extract<OrchestrationWorktree['lifecycle'], { state: 'cleanup-requested' }>
type Provisioning = Extract<OrchestrationWorktree['lifecycle'], { state: 'provisioning' }>

const SETUP_FAILED = 'worktree.SETUP_FAILED'
const SETUP_CANCELLED = 'worktree.SETUP_CANCELLED'

type WorktreeLifecycleReactorOptions = {
  paths: WorkspacePaths
  git: GitWorktreeService
  gate: WorktreeExecutionGate
  provider: () => ProviderService | null
  terminal: TerminalService | undefined
  submodules: (projectId: string) => WorktreeSubmoduleMode
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  getReadModel: () => OrchestrationReadModel
}

export class WorktreeLifecycleReactor {
  readonly name = 'worktree-lifecycle-reactor'
  private recovering = false
  private recoveryCreations: Map<WorktreeId, 'created' | 'adopted'> | null = null
  private readonly pending = new Map<string, Promise<void>>()
  private readonly setups = new SetupRunner()

  private readonly options: WorktreeLifecycleReactorOptions

  constructor(options: WorktreeLifecycleReactorOptions) {
    this.options = options
  }

  handleEvents(events: OrchestrationEvent[]) {
    for (const event of events) {
      if (event.type === 'worktree.setup-updated') {
        this.handleSetupRequest(event.payload.worktreeId, event.payload.setup.state)
        continue
      }
      if (event.aggregateKind !== 'worktree') continue
      const worktree = this.options.getReadModel().worktrees.get(event.aggregateId)
      if (!worktree || worktree.retiredAt) continue
      if (
        [
          'worktree.registered',
          'worktree.revived',
          'worktree.adopted',
          'worktree.retained',
        ].includes(event.type)
      ) {
        this.scheduleRefresh(worktree.id)
      }
      if (
        worktree.lifecycle.state !== 'provisioning' &&
        worktree.lifecycle.state !== 'cleanup-requested'
      )
        continue
      this.schedule(worktree.id, worktree.lifecycle.operationId)
    }
  }

  private handleSetupRequest(worktreeId: WorktreeId, state: WorktreeSetup['state']) {
    if (state === 'queued') this.startSetup(worktreeId)
    if (state === 'cancelling') void this.setups.cancel(worktreeId)
  }

  private schedule(worktreeId: WorktreeId, operationId: CommandId) {
    const key = `${worktreeId}:${operationId}`
    if (this.pending.has(key)) return
    const task = outsideGitRepositoryLane(() => this.run(worktreeId, operationId))
      .catch((error: unknown) => {
        recordProcessWarning('worktree.lifecycle.failed', {
          area: 'worktree',
          worktreeId,
          operationId,
          error,
        })
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, task)
  }

  private scheduleRefresh(worktreeId: WorktreeId) {
    const key = `metadata:${worktreeId}`
    if (this.pending.has(key)) return
    const task = outsideGitRepositoryLane(() => this.refresh(worktreeId))
      .catch((error: unknown) =>
        recordProcessWarning('worktree.metadata.failed', { area: 'worktree', worktreeId, error }),
      )
      .finally(() => this.pending.delete(key))
    this.pending.set(key, task)
  }

  async drain() {
    while (this.pending.size) await Promise.all(this.pending.values())
  }

  isIdle() {
    return this.pending.size === 0
  }

  async repositoryPath(worktree: OrchestrationWorktree): Promise<string> {
    const model = this.options.getReadModel()
    const base = worktree.baseWorktreeId ? model.worktrees.get(worktree.baseWorktreeId) : null
    const candidates = new Set([
      worktree.canonicalPath,
      ...(base ? [base.canonicalPath] : []),
      ...[...model.worktrees.values()]
        .filter((row) => row.projectId === worktree.projectId)
        .map((row) => row.canonicalPath),
    ])
    const managedRoot =
      worktree.ownership === 'platform' || worktree.ownership === 'unclaimed'
        ? path.dirname(worktree.canonicalPath)
        : null
    for (const candidate of candidates) {
      if (await this.matchesRepository(candidate, managedRoot)) return candidate
    }
    throw worktreeRuntimeErrors.UNAVAILABLE({
      internal: {
        at: 'repository-path',
        worktreeId: worktree.id,
        ownership: worktree.ownership,
        candidateCount: candidates.size,
      },
    })
  }

  private async matchesRepository(candidate: string, managedRoot: string | null) {
    try {
      if (!(await pathExists(candidate))) return false
      const actual = await this.options.git.managedRoot(candidate)
      return managedRoot === null || actual === managedRoot
    } catch {
      return false
    }
  }

  async runtimeBlocker(
    worktree: OrchestrationWorktree,
  ): Promise<'active-runtime' | 'active-terminal' | null> {
    const provider = this.options.provider()
    if (provider?.hasWorktreeLease(worktree.id)) return 'active-runtime'
    for (const session of this.options.getReadModel().sessions.values()) {
      if (session.worktreeId !== worktree.id) continue
      if (await provider?.hasRuntime({ sessionId: session.id })) return 'active-runtime'
    }
    if (this.options.terminal?.hasWorktreeRuntime(worktree.id)) return 'active-terminal'
    return null
  }

  async refresh(worktreeId: WorktreeId) {
    const worktree = this.options.getReadModel().worktrees.get(worktreeId)
    if (!worktree || worktree.retiredAt || worktree.lifecycle.state !== 'ready') return
    const project = this.options.getReadModel().projects.get(worktree.projectId)
    if (project?.repositoryKind !== 'git') return
    if (!(await pathExists(worktree.canonicalPath))) return this.markMissing(worktree)
    await this.options.git.withRepositoryLane(await this.repositoryPath(worktree), () =>
      this.refreshInLane(worktreeId),
    )
  }

  private async refreshInLane(worktreeId: WorktreeId) {
    const worktree = this.options.getReadModel().worktrees.get(worktreeId)
    if (!worktree || worktree.retiredAt || worktree.lifecycle.state !== 'ready') return
    const repository = await this.repositoryPath(worktree)
    const listed = await this.options.git.entries(repository)
    if (!listed.some((entry) => entry.absolutePath === worktree.canonicalPath && !entry.prunable)) {
      await this.markMissing(worktree)
      return
    }
    if (worktree.ownership === 'platform' || worktree.ownership === 'unclaimed') {
      await this.options.git.inspect({
        path: repository,
        worktreeId,
        worktreePath: worktree.canonicalPath,
        pathKind: worktree.pathKind,
      })
    }
    const metadata = await this.options.git.metadata({ path: worktree.canonicalPath })
    if (metadata.branch === worktree.branch && metadata.headCommit === worktree.headCommit) return
    await this.options.dispatch({
      type: 'worktree.metadata.refresh',
      worktreeId,
      ...metadata,
      expectedMetadataVersion: worktree.metadataVersion,
      commandId: commandKey(
        'metadata',
        worktreeId,
        worktree.metadataVersion,
        metadata.branch ?? '',
        metadata.headCommit ?? '',
      ),
    })
  }

  private async run(worktreeId: WorktreeId, operationId: CommandId) {
    const worktree = requireWorktree(this.options.getReadModel(), worktreeId)
    const startedAt = performance.now()
    try {
      const created = await this.options.git.withRepositoryLane(
        await this.repositoryPath(worktree),
        async () => {
          const current = requireWorktree(this.options.getReadModel(), worktreeId)
          const state = current.lifecycle
          if (!('operationId' in state) || state.operationId !== operationId) return null
          if (state.state === 'provisioning') return this.provision(current, state)
          if (state.state === 'cleanup-requested') await this.cleanup(current, state)
          return null
        },
      )
      if (created) await this.completeCreation(created.worktree, created.state)
    } catch (error) {
      await this.operationFailure(worktreeId, operationId, error)
    }
    const after = this.options.getReadModel().worktrees.get(worktreeId)?.lifecycle
    recordProcessInfo('worktree.lifecycle.completed', {
      area: 'worktree',
      operationId,
      worktreeId,
      projectId: worktree.projectId,
      from: worktree.lifecycle.state,
      to: after?.state,
      changedFileCount: after?.state === 'cleanup-blocked' ? after.changedFileCount : null,
      recovery: this.recovering,
      durationMs: Math.round(performance.now() - startedAt),
    })
  }

  private async operationFailure(worktreeId: WorktreeId, operationId: CommandId, error: unknown) {
    const worktree = requireWorktree(this.options.getReadModel(), worktreeId)
    const state = worktree.lifecycle
    if (!('operationId' in state) || state.operationId !== operationId) return
    if (state.state === 'cleanup-requested') return this.removalFailure(worktree, state, error)
    if (state.state !== 'provisioning') return
    await this.options.dispatch({
      type: 'worktree.create.fail',
      worktreeId,
      operationId,
      errorCode: errorCode(error),
      commandId: commandKey('creation-failed', worktreeId, operationId),
    })
  }

  private async provision(worktree: OrchestrationWorktree, state: Provisioning) {
    try {
      const result = await this.options.git.create({
        path: await this.repositoryPath(worktree),
        worktreeId: worktree.id,
        baseCommit: state.baseCommit,
        branch: state.branch,
      })
      this.recoveryCreations?.set(worktree.id, result.created ? 'created' : 'adopted')
    } catch (error) {
      await this.options.dispatch({
        type: 'worktree.create.fail',
        worktreeId: worktree.id,
        operationId: state.operationId,
        errorCode: errorCode(error),
        commandId: commandKey('creation-failed', worktree.id, state.operationId),
      })
      return null
    }
    return { worktree, state }
  }

  /** Submodules and a foreground setup finish before the first turn runs, outside the repository lane. */
  private async completeCreation(worktree: OrchestrationWorktree, state: Provisioning) {
    await this.initializeSubmodules(worktree)
    const script = worktree.setup?.state === 'skipped' ? null : this.setupScriptFor(worktree)
    // Boot awaits recovery, so waiting on setup here would hold every request; retry reruns it.
    if (script?.waitForSetup && this.recovering) {
      await this.options.dispatch({
        type: 'worktree.create.fail',
        worktreeId: worktree.id,
        operationId: state.operationId,
        errorCode: SETUP_FAILED,
        commandId: commandKey('setup-recovery-failed', worktree.id, state.operationId),
      })
      return
    }
    if (script?.waitForSetup) {
      const outcome = await this.runSetup(worktree, script, true)
      if (outcome !== 'done') {
        await this.options.dispatch({
          type: 'worktree.create.fail',
          worktreeId: worktree.id,
          operationId: state.operationId,
          errorCode: outcome === 'cancelled' ? SETUP_CANCELLED : SETUP_FAILED,
          commandId: commandKey('setup-failed', worktree.id, state.operationId),
        })
        return
      }
    }
    await this.options.dispatch({
      type: 'worktree.create.complete',
      worktreeId: worktree.id,
      operationId: state.operationId,
      headCommit: state.baseCommit,
      commandId: commandKey('created', worktree.id, state.operationId),
    })
    if (!this.recovering) await this.releaseBlocked(worktree.id, state.operationId)
    if (script && !script.waitForSetup) this.startSetup(worktree.id)
  }

  private setupScriptFor(worktree: OrchestrationWorktree) {
    const project = this.options.getReadModel().projects.get(worktree.projectId)
    return setupScript(project?.scripts ?? [])
  }

  /** A background setup, from worktree creation or a rerun; never awaited by the lifecycle. */
  private startSetup(worktreeId: WorktreeId) {
    const worktree = this.options.getReadModel().worktrees.get(worktreeId)
    const script = worktree ? this.setupScriptFor(worktree) : null
    if (!worktree || !script || this.setups.isRunning(worktreeId)) return
    void this.runSetup(worktree, script, false).catch((error: unknown) =>
      recordProcessWarning('worktree.setup.failed', { area: 'worktree', worktreeId, error }),
    )
  }

  private async runSetup(
    worktree: OrchestrationWorktree,
    script: OrchestrationProjectScript,
    foreground: boolean,
  ) {
    const startedAt = performance.now()
    const report = (setup: Omit<WorktreeSetup, 'name' | 'foreground' | 'updatedAt'>) =>
      this.options.dispatch({
        type: 'worktree.setup.update',
        worktreeId: worktree.id,
        setup: { name: script.name, foreground, updatedAt: new Date().toISOString(), ...setup },
        commandId: commandKey('setup', worktree.id, crypto.randomUUID()),
      })
    const outcome = await this.setups.run(
      worktree.id,
      {
        command: script.command,
        worktreePath: worktree.canonicalPath,
        projectRoot: this.projectRoot(worktree),
      },
      () => report({ state: 'running', exitCode: null, output: [] }),
    )
    await report(outcome)
    recordProcessInfo('worktree.setup.completed', {
      area: 'worktree',
      worktreeId: worktree.id,
      foreground,
      state: outcome.state,
      exitCode: outcome.exitCode,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return outcome.state
  }

  /** The project's main checkout, which setup scripts read as their source of shared files. */
  private projectRoot(worktree: OrchestrationWorktree) {
    const model = this.options.getReadModel()
    const base = worktree.baseWorktreeId ? model.worktrees.get(worktree.baseWorktreeId) : null
    return base?.canonicalPath ?? worktree.canonicalPath
  }

  /** Stops every running setup; the server is going away. */
  closeSetups() {
    return this.setups.close()
  }

  // Failure leaves the worktree usable: git status reports the empty submodules and offers a retry.
  private async initializeSubmodules(worktree: OrchestrationWorktree) {
    const mode = this.options.submodules(worktree.projectId)
    const startedAt = performance.now()
    try {
      const ran = await this.options.git.updateSubmodules(worktree.canonicalPath, mode)
      if (ran)
        recordProcessInfo('worktree.submodules.initialized', {
          area: 'worktree',
          worktreeId: worktree.id,
          mode,
          durationMs: Math.round(performance.now() - startedAt),
        })
    } catch (error) {
      recordProcessWarning('worktree.submodules.failed', {
        area: 'worktree',
        worktreeId: worktree.id,
        mode,
        durationMs: Math.round(performance.now() - startedAt),
        error,
      })
    }
  }

  private async cleanup(worktree: OrchestrationWorktree, state: Cleanup) {
    const lease = this.options.gate.tryAcquireExclusive(worktree.id)
    if (!lease.acquired) {
      if (lease.reason !== 'cleanup-running') await this.block(worktree, state, lease.reason)
      return
    }
    try {
      await this.removeWithLease(worktree, state)
    } finally {
      lease.release()
    }
  }

  private async removeWithLease(worktree: OrchestrationWorktree, state: Cleanup) {
    // A setup still writing into the checkout would race its removal.
    await this.setups.cancel(worktree.id)
    const blocker = await this.runtimeBlocker(worktree)
    if (blocker) return this.block(worktree, state, blocker)
    const target = {
      path: await this.repositoryPath(worktree),
      worktreeId: worktree.id,
      worktreePath: worktree.canonicalPath,
      pathKind: worktree.pathKind,
    }
    try {
      const observed = await this.options.git.inspect(target)
      if (observed.pathExists || observed.adminExists) {
        await this.options.git.remove({ ...target, ...state })
      }
    } catch (error) {
      return this.removalFailure(worktree, state, error)
    }
    await this.options.dispatch({
      type: 'worktree.cleanup.complete',
      worktreeId: worktree.id,
      operationId: state.operationId,
      mode: state.mode,
      commandId: commandKey('removed', worktree.id, state.operationId),
    })
  }

  private async removalFailure(worktree: OrchestrationWorktree, state: Cleanup, error: unknown) {
    if (errorCode(error) === gitWorktreeErrors.WORKTREE_NEEDS_RECONFIRMATION.code)
      return this.block(worktree, state, 'needs-reconfirmation')
    if (errorCode(error) === gitWorktreeErrors.WORKTREE_DIRTY.code) {
      const preview = await this.options.git
        .previewRemoval({
          path: await this.repositoryPath(worktree),
          worktreeId: worktree.id,
          worktreePath: worktree.canonicalPath,
          pathKind: worktree.pathKind,
        })
        .catch(() => null)
      if (!preview) return this.failCleanup(worktree, state, error)
      await this.options.dispatch({
        type: 'worktree.cleanup.blocked',
        worktreeId: worktree.id,
        operationId: state.operationId,
        mode: state.mode,
        reason: 'dirty',
        changedFileCount: preview.changedFileCount,
        commandId: commandKey('cleanup-dirty', worktree.id, state.operationId),
      })
      return
    }
    return this.failCleanup(worktree, state, error)
  }

  private async failCleanup(worktree: OrchestrationWorktree, state: Cleanup, error: unknown) {
    await this.options.dispatch({
      type: 'worktree.cleanup.fail',
      worktreeId: worktree.id,
      operationId: state.operationId,
      mode: state.mode,
      errorCode: errorCode(error),
      commandId: commandKey('cleanup-failed', worktree.id, state.operationId),
    })
  }

  private block(
    worktree: OrchestrationWorktree,
    state: Cleanup,
    reason: 'active-runtime' | 'active-terminal' | 'needs-reconfirmation',
  ) {
    return this.options.dispatch({
      type: 'worktree.cleanup.blocked',
      worktreeId: worktree.id,
      operationId: state.operationId,
      mode: state.mode,
      reason,
      changedFileCount: null,
      commandId: commandKey(`cleanup-${reason}`, worktree.id, state.operationId),
    })
  }

  async releaseBlocked(worktreeId: WorktreeId, operationId: CommandId) {
    for (const session of this.options.getReadModel().sessions.values()) {
      if (
        session.deletedAt ||
        session.worktreeId !== worktreeId ||
        session.latestTurn?.providerStartState !== 'blocked-on-worktree'
      )
        continue
      await this.options.dispatch({
        type: 'session.worktree.release',
        sessionId: session.id,
        turnId: session.latestTurn.turnId,
        operationId,
        commandId: commandKey(
          'release-turn',
          worktreeId,
          operationId,
          session.id,
          session.latestTurn.turnId,
        ),
      })
    }
  }

  async recover() {
    const startedAt = performance.now()
    const before = new Map(
      [...this.options.getReadModel().worktrees.values()].map((row) => [
        row.id,
        row.lifecycle.state,
      ]),
    )
    this.recoveryCreations = new Map()
    this.recovering = true
    try {
      await this.recoverSetups()
      await this.recoverStage('provisioning')
      await this.recoverStage('ready')
      await this.recoverOrphans()
      await this.recoverStage('cleanup-requested')
      await this.releaseReadyWorktrees()
    } finally {
      this.recovering = false
    }
    const after = [...this.options.getReadModel().worktrees.values()]
    const changed = after.filter((row) => before.get(row.id) !== row.lifecycle.state)
    const count = (state: OrchestrationWorktree['lifecycle']['state']) =>
      changed.filter((row) => row.lifecycle.state === state).length
    recordProcessInfo('worktree.reconcile.completed', {
      area: 'worktree',
      scanned: before.size,
      created: [...this.recoveryCreations.values()].filter((outcome) => outcome === 'created')
        .length,
      adopted: [...this.recoveryCreations.values()].filter((outcome) => outcome === 'adopted')
        .length,
      orphaned: count('orphaned'),
      removed: count('removed'),
      blocked: count('cleanup-blocked'),
      failed: count('creation-failed') + count('cleanup-failed'),
      skipped: after.length - changed.length,
      worktreeIds: after.map((row) => row.id),
      operationIds: after.flatMap((row) => (row.operationId ? [row.operationId] : [])),
      durationMs: Math.round(performance.now() - startedAt),
    })
    this.recoveryCreations = null
  }

  private async recoverSetups() {
    for (const worktree of this.options.getReadModel().worktrees.values()) {
      const setup = worktree.setup
      if (
        worktree.retiredAt ||
        !setup ||
        !['queued', 'running', 'cancelling'].includes(setup.state)
      )
        continue
      const state = setup.state === 'cancelling' ? 'cancelled' : 'failed'
      await this.options.dispatch({
        type: 'worktree.setup.update',
        worktreeId: worktree.id,
        setup: {
          ...setup,
          state,
          exitCode: null,
          output: [...setup.output, 'Setup interrupted by a server restart.'],
          updatedAt: new Date().toISOString(),
        },
        commandId: commandKey('setup-recovery', worktree.id, crypto.randomUUID()),
      })
      if (worktree.lifecycle.state !== 'provisioning') continue
      await this.options.dispatch({
        type: 'worktree.create.fail',
        worktreeId: worktree.id,
        operationId: worktree.lifecycle.operationId,
        errorCode: state === 'cancelled' ? SETUP_CANCELLED : SETUP_FAILED,
        commandId: commandKey('setup-recovery-failed', worktree.id, worktree.lifecycle.operationId),
      })
    }
  }

  private async recoverStage(state: 'provisioning' | 'ready' | 'cleanup-requested') {
    for (const worktree of this.options.getReadModel().worktrees.values()) {
      if (worktree.retiredAt || worktree.lifecycle.state !== state) continue
      try {
        await this.reconcile(worktree)
      } catch (error) {
        recordProcessWarning('worktree.reconcile.failed', {
          area: 'worktree',
          worktreeId: worktree.id,
          state,
          error,
        })
      }
    }
  }

  private async releaseReadyWorktrees() {
    for (const worktree of this.options.getReadModel().worktrees.values()) {
      if (worktree.retiredAt || worktree.lifecycle.state !== 'ready' || !worktree.operationId)
        continue
      await this.releaseBlocked(worktree.id, worktree.operationId)
    }
  }

  private async reconcile(worktree: OrchestrationWorktree) {
    const state = worktree.lifecycle
    if (state.state === 'provisioning' || state.state === 'cleanup-requested') {
      await this.run(worktree.id, state.operationId)
      return
    }
    if (state.state !== 'ready') return
    const exists = await pathExists(worktree.canonicalPath)
    const project = this.options.getReadModel().projects.get(worktree.projectId)
    const listed =
      project?.repositoryKind === 'git' && exists
        ? (await this.options.git.entries(await this.repositoryPath(worktree))).some(
            (entry) => entry.absolutePath === worktree.canonicalPath,
          )
        : exists
    if (!listed) {
      await this.markMissing(worktree)
      return
    }
    await this.refresh(worktree.id)
    if (!this.recovering && worktree.operationId)
      await this.releaseBlocked(worktree.id, worktree.operationId)
  }

  private async markMissing(worktree: OrchestrationWorktree) {
    const current = this.options.getReadModel().worktrees.get(worktree.id)
    if (!current || current.lifecycle.state !== 'ready') return
    await this.options.dispatch({
      type: 'worktree.mark-missing',
      worktreeId: current.id,
      commandId: commandKey(
        'missing',
        current.id,
        current.registrationGeneration,
        current.metadataVersion,
      ),
    })
  }

  private async recoverOrphans() {
    const seen = new Set<string>()
    for (const worktree of this.options.getReadModel().worktrees.values()) {
      if (worktree.retiredAt) continue
      if (this.options.getReadModel().projects.get(worktree.projectId)?.repositoryKind !== 'git')
        continue
      if (!(await pathExists(worktree.canonicalPath))) continue
      try {
        const common = await this.options.git.commonDirectory(worktree.canonicalPath)
        if (seen.has(common)) continue
        seen.add(common)
        await this.registerOrphans(worktree)
      } catch (error) {
        recordProcessWarning('worktree.orphans.failed', {
          area: 'worktree',
          worktreeId: worktree.id,
          error,
        })
      }
    }
  }

  private async registerOrphans(current: OrchestrationWorktree) {
    const root = await this.options.git.managedRoot(current.canonicalPath)
    for (const entry of await this.options.git.entries(current.canonicalPath)) {
      const relative = path.relative(root, entry.absolutePath)
      if (
        !relative ||
        relative.startsWith('..') ||
        relative.includes(path.sep) ||
        path.isAbsolute(relative)
      )
        continue
      if (
        [...this.options.getReadModel().worktrees.values()].some(
          (row) => row.canonicalPath === entry.absolutePath,
        )
      )
        continue
      const parsed = v.safeParse(worktreeIdSchema, path.basename(entry.absolutePath))
      const availableId =
        parsed.success && !this.options.getReadModel().worktrees.has(parsed.output)
      const worktreeId = availableId
        ? parsed.output
        : v.parse(worktreeIdSchema, crypto.randomUUID())
      await this.options.dispatch({
        type: 'worktree.orphan.register',
        worktreeId,
        projectId: current.projectId,
        canonicalPath: entry.absolutePath,
        path: this.options.paths.toRealRelative(entry.absolutePath),
        branch: entry.branch,
        headCommit: entry.commit,
        pathKind: availableId ? 'id-derived' : 'legacy',
        reason: (await pathExists(entry.absolutePath))
          ? 'unprojected-managed-path'
          : 'stale-git-admin',
        commandId: commandKey('orphan', current.projectId, entry.absolutePath),
      })
    }
  }
}

function commandKey(...parts: Array<string | number>) {
  return v.parse(commandIdSchema, internalCommandKey('worktree', ...parts))
}

function errorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code
  return 'worktree.OPERATION_FAILED'
}

async function pathExists(target: string) {
  try {
    await lstat(target)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return false
    throw error
  }
}
