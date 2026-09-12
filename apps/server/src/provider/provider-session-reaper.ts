import type { SessionRuntimeStatus, SessionId } from '@workspace/contracts'

import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../orchestration/orchestration-logging'
import type {
  ProviderRuntimeBindingWithMetadata,
  ProviderSessionDirectory,
} from './provider-session-directory'

/** How long a session may sit doing nothing before its process is reclaimed. */
const IDLE_PROVIDER_SESSION_DEADLINE_MS = 30 * 60 * 1000

/**
 * The only status a reaper may touch. `running` and `waiting` are the agent
 * mid-work — `waiting` covers compaction and an unanswered approval, both of
 * which lose real state if the process dies. `starting` has not reported yet,
 * and `stopped`/`error` have no process left to reclaim.
 */
const REAPABLE_STATUS: SessionRuntimeStatus = 'ready'

type StopRuntime = (input: { sessionId: SessionId }) => Promise<unknown>

/**
 * Reclaims the child processes of sessions nobody is using.
 *
 * Deliberately demand-triggered rather than on a timer: it sweeps when a new
 * session is about to be started, which is the moment the cost of holding idle
 * ones is about to be paid. An interval would also have to reason about
 * shutdown ordering and would fire inside every test in the suite, for a
 * reclaim nobody is waiting on — an idle machine has nothing to lose by holding
 * a process until it is next asked to start one.
 *
 * Safety rests entirely on the liveness stamp: `lastSeenAt` moves with the
 * provider's own event stream, not just with status transitions, so a session
 * doing long background work reads as recently seen even though its status has
 * not changed in an hour. Without that feed this class would kill live work,
 * which is why it must never be pointed at a directory that is not being fed.
 */
export class ProviderSessionReaper {
  private readonly deadlineMs: number
  private readonly directory: ProviderSessionDirectory
  private readonly now: () => number
  private readonly isLaunching: (sessionId: SessionId) => boolean
  private readonly stopRuntime: StopRuntime

  constructor(options: {
    deadlineMs?: number
    directory: ProviderSessionDirectory
    now?: () => number
    isLaunching?: (sessionId: SessionId) => boolean
    stopRuntime: StopRuntime
  }) {
    this.deadlineMs = options.deadlineMs ?? IDLE_PROVIDER_SESSION_DEADLINE_MS
    this.directory = options.directory
    this.now = options.now ?? Date.now
    this.isLaunching = options.isLaunching ?? (() => false)
    this.stopRuntime = options.stopRuntime
  }

  /**
   * Never rejects. A sweep is opportunistic housekeeping running alongside work
   * the user actually asked for, and one adapter that cannot stop must not fail
   * the turn that triggered the sweep.
   */
  async sweep(options: { exceptSessionId?: SessionId } = {}) {
    const idle = this.idleBindings(options.exceptSessionId)
    if (idle.length === 0) return []

    const reaped: SessionId[] = []
    for (const binding of idle) {
      const stopped = await this.reap(binding)
      if (!stopped) continue

      reaped.push(binding.sessionId)
    }

    recordChatPipelineInfo('chat.pipeline.provider_session_reaper.sweep', {
      deadlineMs: this.deadlineMs,
      idleCount: idle.length,
      reapedCount: reaped.length,
      sessionIds: reaped,
    })

    return reaped
  }

  private idleBindings(exceptSessionId: SessionId | undefined) {
    const cutoff = new Date(this.now() - this.deadlineMs).toISOString()

    return this.directory
      .listIdleSince(cutoff, REAPABLE_STATUS)
      .filter((binding) => binding.sessionId !== exceptSessionId)
      .filter((binding) => !this.isLaunching(binding.sessionId))
  }

  private async reap(binding: ProviderRuntimeBindingWithMetadata) {
    try {
      await this.stopRuntime({ sessionId: binding.sessionId })
      return true
    } catch (error) {
      recordChatPipelineWarning('chat.pipeline.provider_session_reaper.stop_failed', {
        error,
        lastSeenAt: binding.lastSeenAt,
        sessionId: binding.sessionId,
      })
      return false
    }
  }
}
