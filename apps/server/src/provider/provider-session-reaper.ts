import {
  errorMessage,
  errorStringField,
  type SessionRuntimeStatus,
  type SessionId,
} from '@workspace/contracts'

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

/** Identical stop failures in a row before a binding is orphaned and left alone. */
const ORPHAN_AFTER_FAILURES = 2

type StopRuntime = (input: { sessionId: SessionId; idleBefore: string }) => Promise<unknown>

/**
 * The last stop this reaper made on a binding. It holds only while the binding is untouched:
 * any runtime event or relaunch moves `lastSeenAt` or `runtimeEpoch`, and the binding is live again.
 */
type StopAttempt = {
  failure: string | null
  failures: number
  lastSeenAt: string
  runtimeEpoch: string
}

export class ProviderSessionReaper {
  private readonly attempts = new Map<SessionId, StopAttempt>()
  private readonly deadlineMs: number
  private readonly directory: ProviderSessionDirectory
  private readonly now: () => number
  private readonly isLaunching: (sessionId: SessionId) => boolean
  private readonly hasBackgroundWork: (sessionId: SessionId) => boolean
  private readonly stopRuntime: StopRuntime
  private pendingSweep: Promise<SessionId[]> | null = null

  constructor(options: {
    deadlineMs?: number
    directory: ProviderSessionDirectory
    now?: () => number
    isLaunching?: (sessionId: SessionId) => boolean
    hasBackgroundWork?: (sessionId: SessionId) => boolean
    stopRuntime: StopRuntime
  }) {
    this.deadlineMs = options.deadlineMs ?? IDLE_PROVIDER_SESSION_DEADLINE_MS
    this.directory = options.directory
    this.now = options.now ?? Date.now
    this.isLaunching = options.isLaunching ?? (() => false)
    this.hasBackgroundWork = options.hasBackgroundWork ?? (() => false)
    this.stopRuntime = options.stopRuntime
  }

  /**
   * Never rejects. A sweep is opportunistic housekeeping running alongside work
   * the user actually asked for, and one adapter that cannot stop must not fail
   * the turn that triggered the sweep.
   */
  sweep(options: { exceptSessionId?: SessionId } = {}) {
    if (this.pendingSweep) return this.pendingSweep
    this.pendingSweep = this.runSweep(options).finally(() => {
      this.pendingSweep = null
    })
    return this.pendingSweep
  }

  async waitForIdle() {
    await this.pendingSweep
  }

  private async runSweep(options: { exceptSessionId?: SessionId }) {
    const candidates = this.listIdle()
    this.forgetAttemptsOutside(candidates)
    const idle = this.reapable(candidates, options.exceptSessionId)
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

  private listIdle() {
    const cutoff = new Date(this.now() - this.deadlineMs).toISOString()
    return this.directory.listIdleSince(cutoff, REAPABLE_STATUS)
  }

  private reapable(
    idle: readonly ProviderRuntimeBindingWithMetadata[],
    exceptSessionId: SessionId | undefined,
  ) {
    return idle
      .filter((binding) => binding.sessionId !== exceptSessionId)
      .filter((binding) => !this.isLaunching(binding.sessionId))
      .filter((binding) => !this.hasBackgroundWork(binding.sessionId))
      .filter((binding) => !this.isSettled(binding))
  }

  /** Stopped with nothing touching it since, or orphaned: either way there is nothing to retry. */
  private isSettled(binding: ProviderRuntimeBindingWithMetadata) {
    const attempt = this.attemptFor(binding)
    if (!attempt) return false

    return attempt.failure === null || attempt.failures >= ORPHAN_AFTER_FAILURES
  }

  private attemptFor(binding: ProviderRuntimeBindingWithMetadata) {
    const attempt = this.attempts.get(binding.sessionId)
    if (!attempt) return null
    if (attempt.runtimeEpoch !== binding.runtimeEpoch) return null
    if (attempt.lastSeenAt !== binding.lastSeenAt) return null

    return attempt
  }

  private forgetAttemptsOutside(idle: readonly ProviderRuntimeBindingWithMetadata[]) {
    const idleSessionIds = new Set(idle.map((binding) => binding.sessionId))
    for (const sessionId of this.attempts.keys()) {
      if (idleSessionIds.has(sessionId)) continue

      this.attempts.delete(sessionId)
    }
  }

  private async reap(binding: ProviderRuntimeBindingWithMetadata) {
    if (
      !this.reapable(this.listIdle(), undefined).some(
        (current) =>
          current.sessionId === binding.sessionId && current.runtimeEpoch === binding.runtimeEpoch,
      )
    )
      return false
    try {
      const result = await this.stopRuntime({
        sessionId: binding.sessionId,
        idleBefore: new Date(this.now() - this.deadlineMs).toISOString(),
      })
      if (result === null) return false

      this.attempts.set(binding.sessionId, stopAttempt(binding, null, 0))
      return true
    } catch (error) {
      this.recordFailure(binding, error)
      return false
    }
  }

  private recordFailure(binding: ProviderRuntimeBindingWithMetadata, error: unknown) {
    const failure = failureKey(error)
    const previous = this.attemptFor(binding)
    const failures = previous?.failure === failure ? previous.failures + 1 : 1
    this.attempts.set(binding.sessionId, stopAttempt(binding, failure, failures))
    const context = {
      error,
      failures,
      lastSeenAt: binding.lastSeenAt,
      providerInstanceId: binding.providerInstanceId,
      sessionId: binding.sessionId,
    }
    if (failures < ORPHAN_AFTER_FAILURES) {
      recordChatPipelineInfo('chat.pipeline.provider_session_reaper.stop_failed', context)
      return
    }

    recordChatPipelineWarning('chat.pipeline.provider_session_reaper.orphaned', context)
  }
}

function stopAttempt(
  binding: ProviderRuntimeBindingWithMetadata,
  failure: string | null,
  failures: number,
): StopAttempt {
  return {
    failure,
    failures,
    lastSeenAt: binding.lastSeenAt,
    runtimeEpoch: binding.runtimeEpoch,
  }
}

function failureKey(error: unknown) {
  return `${errorStringField(error, 'code') ?? ''}:${errorMessage(error)}`
}
