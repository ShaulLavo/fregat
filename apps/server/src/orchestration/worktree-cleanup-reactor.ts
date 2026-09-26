import * as v from 'valibot'
import {
  commandIdSchema,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationWorktree,
} from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning } from '../observability'
import type { OrchestrationReadModel } from './read-model'
import { SweepReactor } from './sweep-scheduler'
import { internalCommandKey } from './utils/repository-ids'
import { worktreeCleanupEligibility } from './utils/worktree-policy'

type Options = {
  getReadModel: () => OrchestrationReadModel
  dispatch: (command: OrchestrationCommand) => Promise<unknown>
  /** The project's setting: remove a worktree once its last session is deleted. */
  cleanupOnDelete: (projectId: string) => boolean
  /** Whether the deletion event at that sequence asked for the worktree to go. */
  deletionRemovesWorktree: (sequence: number) => boolean
  /** Why the checkout must stay, read from git; null when nothing stops removal. */
  obstacle: (worktree: OrchestrationWorktree) => Promise<string | null>
  intervalMs?: number
}

const SWEEP_INTERVAL_MS = 60 * 60_000
const TRIGGERS = new Set<OrchestrationEvent['type']>([
  'session.deleted',
  'session.deletion-updated',
])

/**
 * Removes a session worktree whose sessions are all deleted and stopped, when the last deletion
 * asked for it or the project's setting does. It only requests `worktree.cleanup`: the decider
 * refuses a worktree anything still references, and the lifecycle reactor refuses a dirty one.
 */
export class WorktreeCleanupReactor extends SweepReactor {
  readonly name = 'worktree-cleanup-reactor'
  private readonly options: Options

  constructor(options: Options) {
    super({
      failureEvent: 'worktree.auto_cleanup.failed',
      area: 'worktree',
      intervalMs: options.intervalMs ?? SWEEP_INTERVAL_MS,
    })
    this.options = options
  }

  handleEvents(events: OrchestrationEvent[]) {
    if (events.some((event) => TRIGGERS.has(event.type))) this.schedule()
  }

  protected async sweep() {
    const model = this.options.getReadModel()
    const skipped: Record<string, number> = {}
    let requested = 0
    for (const worktree of model.worktrees.values()) {
      const deletion = this.wanted(model, worktree)
      if (deletion === null) continue
      const outcome = await this.request(worktree, deletion)
      if (outcome === 'requested') requested += 1
      else skipped[outcome] = (skipped[outcome] ?? 0) + 1
    }
    if (requested === 0 && Object.keys(skipped).length === 0) return
    recordProcessInfo('worktree.auto_cleanup', { area: 'worktree', requested, skipped })
  }

  /** The last deletion's sequence when this worktree should go now; null otherwise. */
  private wanted(model: OrchestrationReadModel, worktree: OrchestrationWorktree) {
    if (worktree.ownership !== 'platform' || worktree.lifecycle.state !== 'ready') return null
    const references = [...model.sessions.values()].filter(
      (session) => session.worktreeId === worktree.id,
    )
    // A worktree no session ever used was not left behind by a deletion.
    if (references.length === 0) return null
    if (worktreeCleanupEligibility(worktree, references).reason !== 'eligible') return null
    const last = Math.max(...references.map((session) => session.deletion?.deletionSequence ?? 0))
    if (this.options.cleanupOnDelete(worktree.projectId)) return last
    return this.options.deletionRemovesWorktree(last) ? last : null
  }

  private async request(worktree: OrchestrationWorktree, deletion: number) {
    const obstacle = await this.options.obstacle(worktree)
    if (obstacle) return obstacle
    // Git calls take time; a new session or a turned-off setting since then keeps the checkout.
    const current = this.options.getReadModel().worktrees.get(worktree.id)
    if (!current || this.wanted(this.options.getReadModel(), current) !== deletion)
      return 'changed-during-check'
    try {
      await this.options.dispatch({
        type: 'worktree.cleanup',
        worktreeId: worktree.id,
        commandId: v.parse(
          commandIdSchema,
          internalCommandKey('auto-cleanup', worktree.id, deletion),
        ),
      })
      return 'requested'
    } catch (error) {
      recordProcessWarning('worktree.auto_cleanup.refused', {
        area: 'worktree',
        worktreeId: worktree.id,
        error,
      })
      return 'refused'
    }
  }
}
