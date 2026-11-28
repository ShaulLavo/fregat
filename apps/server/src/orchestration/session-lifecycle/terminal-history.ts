import {
  commandIdSchema,
  errorStringField,
  eventIdSchema,
  type OrchestrationCommand,
  type SessionId,
  type TerminalLease,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { OrchestrationDatabase } from '../event-store'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from '../read-model'
import { TerminalHandoffs, type TerminalHandoff } from '../terminal-handoffs'
import type { TerminalLeaseController } from '../terminal-lease-controller'
import { terminalHistoryMessages } from '../utils/terminal-history'
import { historyRevision } from '../utils/import-history'
import { internalCommandKey } from '../utils/repository-ids'
import { sessionIdentityErrors } from '../../provider/structured-errors'
import type { ProviderService } from '../../provider/provider-service'
import type { AgentTerminalResolver, AgentTerminalProcess } from '../../terminal/agent-launch'
import { terminalSessionKey } from '../../terminal/service'
import type { HostSessionInfo } from '../../terminal-host/protocol'
import {
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from '../../observability/chat-pipeline'

type TerminalHistoryOptions = {
  readonly provider: () => ProviderService | null
  readonly leases: TerminalLeaseController
  readonly readModel: () => Pick<OrchestrationReadModel, 'worktrees' | 'terminalLeases'>
  readonly hostSessions: () => Promise<readonly HostSessionInfo[] | null>
  readonly dispatch: (command: OrchestrationCommand) => Promise<unknown>
}

export class AgentTerminalHistory {
  private readonly handoffs: TerminalHandoffs
  private readonly recoveries = new Map<SessionId, Promise<void>>()

  private readonly options: TerminalHistoryOptions

  constructor(database: OrchestrationDatabase, options: TerminalHistoryOptions) {
    this.options = options
    this.handoffs = new TerminalHandoffs(database)
  }

  async reserve(
    session: OrchestrationProjectedSession,
    provider: ProviderService,
    lease: Parameters<AgentTerminalResolver>[0],
  ) {
    const sessionId = session.id
    const pending = this.handoffs.get(sessionId)
    if (pending) await this.retryTerminalHistory(pending, provider)
    const launch = await provider.reserveTerminalRuntime({
      sessionId,
      providerInstanceId: session.modelSelection.providerInstanceId,
    })
    return this.prepareTerminalHistory({ session, provider, launch, lease })
  }

  private async prepareTerminalHistory({
    session,
    provider,
    launch,
    lease,
  }: {
    session: OrchestrationProjectedSession
    provider: ProviderService
    launch: AgentTerminalProcess
    lease: Parameters<AgentTerminalResolver>[0]
  }) {
    const worktree = this.options.readModel().worktrees.get(session.worktreeId)
    if (!worktree) {
      launch.release()
      throw sessionIdentityErrors.TERMINAL_SESSION_INVALID({
        internal: {
          at: 'terminal-launch',
          sessionId: session.id,
          worktreeId: session.worktreeId,
          reason: 'worktree-absent',
        },
      })
    }
    const startedAt = new Date().toISOString()
    const input = {
      sessionId: session.id,
      providerInstanceId: session.modelSelection.providerInstanceId,
      cwd: worktree.canonicalPath,
    }
    try {
      const before = await provider.readSessionHistory(input)
      const handoff: TerminalHandoff = {
        ...input,
        worktreeId: session.worktreeId,
        terminalLeaseId: lease.terminalLeaseId,
        runtimeEpoch: lease.runtimeEpoch,
        startedAt,
        baseline: before.map((message) => message.sourceId),
        phase: 'active',
      }
      this.handoffs.begin(handoff)
      return {
        ...launch,
        reconcile: () => {
          this.handoffs.exited(session.id)
          return this.appendTerminalHistory(provider, handoff)
        },
        release: () => {
          this.handoffs.complete(session.id)
          launch.release()
        },
      }
    } catch (error) {
      launch.release()
      throw error
    }
  }

  private async appendTerminalHistory(provider: ProviderService, handoff: TerminalHandoff) {
    provider.markTerminalHistoryPending(handoff.sessionId)
    try {
      const after = await provider.readSessionHistory(handoff)
      const messages = terminalHistoryMessages(
        handoff.sessionId,
        handoff.startedAt,
        handoff.baseline,
        after,
      )
      if (!messages.length) return
      await this.options.dispatch({
        type: 'session.terminal-history.append',
        sessionId: handoff.sessionId,
        messages,
        commandId: v.parse(
          commandIdSchema,
          internalCommandKey(
            'session.terminal-history.append',
            handoff.sessionId,
            historyRevision(JSON.stringify(messages)),
          ),
        ),
      })
      recordChatPipelineInfo('chat.pipeline.terminal_history.summary', {
        sessionId: handoff.sessionId,
        messageCount: messages.length,
        outcome: 'synchronized',
      })
    } catch (error) {
      await this.recordTerminalHistoryFailure(handoff.sessionId, handoff.startedAt, error).catch(
        (failure: unknown) => {
          recordChatPipelineWarning('chat.pipeline.terminal_history.failure_record_failed', {
            sessionId: handoff.sessionId,
            error: failure,
          })
        },
      )
      throw error
    }
  }

  private async recordTerminalHistoryFailure(
    sessionId: SessionId,
    startedAt: string,
    error: unknown,
  ) {
    const message = errorStringField(error, 'message') ?? 'The provider history could not be read.'
    const unknownOwnership =
      errorStringField(error, 'code') === 'provider.TERMINAL_OWNERSHIP_UNKNOWN'
    const key = internalCommandKey(
      'terminal-history-failed',
      sessionId,
      startedAt,
      historyRevision(message),
    )
    recordChatPipelineWarning('chat.pipeline.terminal_history.summary', {
      sessionId,
      outcome: 'failed',
      error,
    })
    await this.options.dispatch({
      type: 'session.activity.append',
      commandId: v.parse(commandIdSchema, key),
      sessionId,
      createdAt: startedAt,
      activity: {
        id: v.parse(eventIdSchema, key),
        sessionId,
        createdAt: startedAt,
        turnId: null,
        tone: 'error',
        kind: unknownOwnership ? 'terminal.ownership.unknown' : 'terminal.history.failed',
        summary: unknownOwnership
          ? 'An earlier terminal may still be running this session'
          : 'The terminal conversation could not be copied into this chat',
        payload: {
          message,
          fix:
            errorStringField(error, 'fix') ??
            'Reopen the session’s terminal to copy the conversation again.',
        },
      },
    })
  }

  attachAdopted(lease: TerminalLease) {
    const owned = this.options.leases.attachAdopted(lease.worktreeId, lease.terminalLeaseId)
    const provider = this.options.provider()
    const handoff = this.handoffs
      .pending()
      .find((entry) => entry.terminalLeaseId === lease.terminalLeaseId)
    if (!provider || !handoff) return owned
    return {
      ...owned,
      end: async () => {
        this.handoffs.exited(handoff.sessionId)
        await this.appendTerminalHistory(provider, handoff)
        await owned.end()
        this.handoffs.complete(handoff.sessionId)
        provider.releaseTerminalOwnership(handoff.sessionId)
      },
    }
  }

  /**
   * A pending agent-in-terminal handoff is adopted when the host still runs its shell, so the
   * session resumes as an ordinary terminal instead of being blocked on unknown ownership.
   */
  async recover() {
    const provider = this.options.provider()
    if (!provider) return
    const pending = this.handoffs.pending()
    const sessions = await this.options.hostSessions()
    const byKey = sessions ? new Map(sessions.map((session) => [session.key, session])) : null
    for (const handoff of pending) {
      await this.recoverTerminalHandoff(handoff, provider, byKey)
    }
  }

  private async recoverTerminalHandoff(
    handoff: TerminalHandoff,
    provider: ProviderService,
    sessions: ReadonlyMap<string, HostSessionInfo> | null,
  ) {
    const key = terminalSessionKey(handoff.worktreeId, handoff.sessionId, handoff.sessionId)
    const live = sessions?.get(key)
    if (handoff.phase === 'active' && live && !live.exited) {
      const lease = this.options.readModel().terminalLeases.get(handoff.terminalLeaseId)
      if (lease)
        await this.options.leases.adopt(
          handoff.worktreeId,
          lease.terminalLeaseId,
          lease.runtimeEpoch,
        )
      provider.restoreTerminalOwnership(handoff.sessionId, 'terminal')
      return
    }
    if (handoff.phase === 'active' && sessions !== null) {
      this.handoffs.exited(handoff.sessionId)
      handoff = { ...handoff, phase: 'history' }
    }
    provider.restoreTerminalOwnership(
      handoff.sessionId,
      handoff.phase === 'history' ? 'history' : 'unknown',
    )
    await this.retryTerminalHistory(handoff, provider).catch((error: unknown) =>
      this.recordTerminalHistoryFailure(handoff.sessionId, handoff.startedAt, error),
    )
  }

  private retryTerminalHistory(handoff: TerminalHandoff, provider: ProviderService) {
    const existing = this.recoveries.get(handoff.sessionId)
    if (existing) return existing
    const recovery = this.finishTerminalHistoryRecovery(handoff, provider).finally(() => {
      this.recoveries.delete(handoff.sessionId)
    })
    this.recoveries.set(handoff.sessionId, recovery)
    return recovery
  }

  private async finishTerminalHistoryRecovery(handoff: TerminalHandoff, provider: ProviderService) {
    if (handoff.phase === 'active')
      throw sessionIdentityErrors.TERMINAL_OWNERSHIP_UNKNOWN({
        internal: { at: 'history-recovery', sessionId: handoff.sessionId, phase: handoff.phase },
      })
    await this.options.leases.endRecovered(handoff.terminalLeaseId)
    await this.appendTerminalHistory(provider, handoff)
    this.handoffs.complete(handoff.sessionId)
    provider.releaseTerminalOwnership(handoff.sessionId)
  }
}
