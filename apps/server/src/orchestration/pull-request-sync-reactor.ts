import * as v from 'valibot'
import {
  commandIdSchema,
  jsonEqual,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type WorktreePullRequest,
} from '@workspace/contracts'
import type { BranchPullRequests } from '../git/pull-request'
import { recordProcessInfo, recordProcessWarning } from '../observability'
import type { OrchestrationProjectedWorktree, OrchestrationReadModel } from './read-model'
import { internalCommandKey } from './utils/repository-ids'
import { SweepScheduler } from './sweep-scheduler'

export type BranchPullRequestLookup = (input: {
  cwd: string
  branches: readonly string[]
}) => Promise<BranchPullRequests>

type Options = {
  lookupIdentity?: (
    worktree: OrchestrationProjectedWorktree,
    identity: { remoteUrl: string; number: number },
  ) => Promise<WorktreePullRequest>
  lookup: BranchPullRequestLookup
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  getReadModel: () => OrchestrationReadModel
  /** The branch name the forge knows a worktree by: its upstream's, else its own. */
  headName?: (worktree: OrchestrationProjectedWorktree) => Promise<string>
  now?: () => number
  intervalMs?: number
}

const SWEEP_INTERVAL_MS = 60_000
// Settled work, closed and unsupported answers change rarely; merged never changes.
const SLOW_SYNC_MS = 15 * 60_000
const MAX_BACKOFF_MS = 30 * 60_000

type Candidate = { worktree: OrchestrationProjectedWorktree; branch: string; active: boolean }

/**
 * Keeps the pull request of every dedicated session worktree current. A sweep groups due
 * worktrees by project, so each repository costs one lookup however many sessions it has. A
 * failed lookup backs its repository off and keeps what was known; only a worktree with no
 * answer yet becomes `unknown`.
 */
export class PullRequestSyncReactor {
  readonly name = 'pull-request-sync-reactor'
  private readonly options: Options
  private readonly now: () => number
  private readonly lastSyncedAt = new Map<string, number>()
  private readonly backoff = new Map<string, { failures: number; until: number }>()
  private readonly sweeps: SweepScheduler

  constructor(options: Options) {
    this.options = options
    this.now = options.now ?? Date.now
    this.sweeps = new SweepScheduler({
      sweep: () => this.sweep(),
      failureEvent: 'git.pull_request_sync.failed',
      area: 'git',
      intervalMs: options.intervalMs ?? SWEEP_INTERVAL_MS,
    })
  }

  start() {
    this.sweeps.start()
  }

  // A new or renamed branch is looked up at once instead of on the next minute.
  handleEvents(events: OrchestrationEvent[]) {
    const branchMoved = events.some(
      (event) =>
        event.type === 'worktree.created' ||
        event.type === 'worktree.adopted' ||
        (event.type === 'worktree.metadata-refreshed' &&
          this.options.getReadModel().worktrees.get(event.payload.worktreeId)?.pullRequest ===
            null),
    )
    if (branchMoved) this.schedule()
  }

  schedule() {
    this.sweeps.schedule()
  }

  drain() {
    return this.sweeps.drain()
  }

  close() {
    return this.sweeps.close()
  }

  private async sweep() {
    const startedAt = this.now()
    const groups = this.dueGroups()
    let changed = 0
    let failed = 0
    for (const [projectId, candidates] of groups) {
      const outcome = await this.syncProject(projectId, candidates)
      changed += outcome.changed
      if (outcome.failed) failed += 1
    }
    if (groups.size === 0) return
    recordProcessInfo('git.pull_request_sync', {
      area: 'git',
      repositories: groups.size,
      worktrees: [...groups.values()].reduce((sum, group) => sum + group.length, 0),
      changed,
      failed,
      durationMs: this.now() - startedAt,
    })
  }

  private dueGroups() {
    const model = this.options.getReadModel()
    const groups = new Map<string, Candidate[]>()
    for (const candidate of trackedWorktrees(model)) {
      if (!this.isDue(candidate)) continue
      const projectId = candidate.worktree.projectId
      const backoff = this.backoff.get(projectId)
      if (backoff && backoff.until > this.now()) continue
      groups.set(projectId, [...(groups.get(projectId) ?? []), candidate])
    }
    return groups
  }

  private headOf(candidate: Candidate) {
    return (
      this.options.headName?.(candidate.worktree).catch(() => candidate.branch) ?? candidate.branch
    )
  }

  private isDue({ worktree, active }: Candidate) {
    const known = worktree.pullRequest
    if (!known || known.status === 'unknown') return true
    if (known.status === 'found' && known.state === 'merged') return false
    const openWork = known.status === 'none' || (known.status === 'found' && known.state === 'open')
    if (active && openWork) return true
    const last = this.lastSyncedAt.get(worktree.id)
    return last === undefined || this.now() - last >= SLOW_SYNC_MS
  }

  private async syncProject(projectId: string, candidates: readonly Candidate[]) {
    const first = candidates[0]
    if (!first) return { changed: 0, failed: false }
    const pinned = candidates.filter(
      ({ worktree }) => worktree.pullRequest?.status === 'found' && worktree.pullRequest.identity,
    )
    let pinnedChanged = 0
    const identities = new Map<string, Candidate[]>()
    for (const candidate of pinned) {
      const known = candidate.worktree.pullRequest
      if (known?.status !== 'found') continue
      const key = JSON.stringify(known.identity)
      const group = identities.get(key) ?? []
      group.push(candidate)
      identities.set(key, group)
    }
    for (const group of identities.values()) {
      const result = await this.syncIdentity(projectId, group)
      pinnedChanged += result.changed
      if (result.failed) return { changed: pinnedChanged, failed: true }
    }
    candidates = candidates.filter((candidate) => !pinned.includes(candidate))
    if (candidates.length === 0) {
      this.backoff.delete(projectId)
      return { changed: pinnedChanged, failed: false }
    }
    const heads = await Promise.all(candidates.map((candidate) => this.headOf(candidate)))
    let answer: BranchPullRequests
    try {
      answer = await this.options.lookup({
        cwd: first.worktree.canonicalPath,
        branches: heads,
      })
    } catch (error) {
      this.recordFailure(projectId, error)
      const unknown = candidates.filter((candidate) => !candidate.worktree.pullRequest)
      const changed = await this.apply(unknown, () => ({ status: 'unknown' }))
      return { changed, failed: true }
    }
    this.backoff.delete(projectId)
    const byBranch = new Map(candidates.map((candidate, index) => [candidate.branch, heads[index]]))
    const changed = await this.apply(candidates, (branch) =>
      pullRequestFor(answer, byBranch.get(branch) ?? branch),
    )
    return { changed: changed + pinnedChanged, failed: false }
  }

  private async syncIdentity(projectId: string, candidates: readonly Candidate[]) {
    const candidate = candidates[0]
    const known = candidate?.worktree.pullRequest
    if (!candidate || known?.status !== 'found' || !known.identity || !this.options.lookupIdentity)
      return { changed: 0, failed: false }
    try {
      const answer = await this.options.lookupIdentity(candidate.worktree, known.identity)
      return { changed: await this.apply(candidates, () => answer), failed: false }
    } catch (error) {
      this.recordFailure(projectId, error)
      return { changed: 0, failed: true }
    }
  }

  private recordFailure(projectId: string, error: unknown) {
    const failures = (this.backoff.get(projectId)?.failures ?? 0) + 1
    const delay = Math.min(MAX_BACKOFF_MS, SWEEP_INTERVAL_MS * 2 ** (failures - 1))
    this.backoff.set(projectId, { failures, until: this.now() + delay })
    recordProcessWarning('git.pull_request_sync.lookup_failed', {
      area: 'git',
      projectId,
      failures,
      retryInMs: delay,
      error,
    })
  }

  private async apply(
    candidates: readonly Candidate[],
    answer: (branch: string) => WorktreePullRequest,
  ) {
    let changed = 0
    for (const { worktree, branch } of candidates) {
      const current = this.options.getReadModel().worktrees.get(worktree.id)
      if (!jsonEqual(current?.pullRequest, worktree.pullRequest)) continue
      const pullRequest = answer(branch)
      this.lastSyncedAt.set(worktree.id, this.now())
      if (jsonEqual(worktree.pullRequest, pullRequest)) continue
      try {
        await this.options.dispatch({
          type: 'worktree.pull-request.sync',
          worktreeId: worktree.id,
          branch,
          pullRequest,
          commandId: v.parse(
            commandIdSchema,
            internalCommandKey('pull-request', worktree.id, crypto.randomUUID()),
          ),
        })
        changed += 1
      } catch (error) {
        // The branch moved while the lookup ran; the metadata event schedules a fresh sweep.
        recordProcessWarning('git.pull_request_sync.stale', {
          area: 'git',
          worktreeId: worktree.id,
          error,
        })
      }
    }
    return changed
  }
}

/** Dedicated session worktrees: a shared checkout's branch belongs to no one session. */
function* trackedWorktrees(model: OrchestrationReadModel): Generator<Candidate> {
  const activity = sessionActivity(model)
  for (const worktree of model.worktrees.values()) {
    if (worktree.retiredAt || worktree.lifecycle.state !== 'ready') continue
    if (worktree.ownership !== 'platform' || worktree.kind !== 'linked' || !worktree.branch)
      continue
    if (model.projects.get(worktree.projectId)?.repositoryKind !== 'git') continue
    const active = activity.get(worktree.id)
    if (active === undefined) continue
    yield { worktree, branch: worktree.branch, active }
  }
}

/** Per worktree: whether any visible session on it is still unsettled. */
function sessionActivity(model: OrchestrationReadModel) {
  const activity = new Map<string, boolean>()
  for (const session of model.sessions.values()) {
    if (session.deletedAt || session.archivedAt) continue
    const unsettled = session.settledOverride !== 'settled' && !session.settledAt
    activity.set(session.worktreeId, (activity.get(session.worktreeId) ?? false) || unsettled)
  }
  return activity
}

function pullRequestFor(answer: BranchPullRequests, branch: string): WorktreePullRequest {
  if (answer.kind === 'unsupported') return { status: 'unsupported', support: answer.support }
  const pullRequest = answer.pullRequests.get(branch)
  if (!pullRequest) return { status: 'none' }
  return { status: 'found', ...pullRequest, closedAt: pullRequest.closedAt ?? null }
}
