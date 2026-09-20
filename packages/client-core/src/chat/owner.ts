import {
  errorStringField,
  ORCHESTRATION_REPLAY_MAX_EVENTS,
  type ClientOrchestrationCommand,
  type OrchestrationDispatchResult,
  type SessionId,
} from '@workspace/contracts'

import type { Client } from '../transport/client'
import type { OrchestrationRpcClient } from '../transport/orchestration-rpc-client'
import { chatCommandSummary } from '@workspace/contracts'
import { createOrchestrationRpcClosedError } from '../transport/structured-errors'
import { readChatSession, readChatShell } from './snapshots'
import { createClientError } from '../errors'
import {
  createInitialChatProjectionSlice,
  type ChatProjectionSlice,
  type ChatSession,
} from './types'
import {
  chatSessionEarlierPageInput,
  selectChatSessionHasEarlier,
  selectChatSessionById,
} from './selectors'
import {
  applyChatProjectionEvents,
  applyChatProjectionSessionStreamItem,
  applyChatProjectionShellStreamItem,
  prependChatProjectionSessionDetailPage,
  syncChatProjectionSessionDetailSnapshot,
  syncChatProjectionShellSnapshot,
} from './writers'

export type ChatOwnerSnapshot = {
  readonly projection: ChatProjectionSlice
  readonly selectedSessionId: SessionId | null
  readonly status: 'loading' | 'ready' | 'failed'
  readonly detailLoading: boolean
  readonly loadingEarlier: boolean
  readonly error: string | null
  readonly pendingCommands: number
}

export type ChatOwnerOptions = {
  readonly client: Client
  readonly rpc: OrchestrationRpcClient
  readonly record?: (event: Record<string, unknown>) => void
}

export function createChatOwner(options: ChatOwnerOptions) {
  return new ChatOwner(options)
}

export class ChatOwner {
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly options: ChatOwnerOptions
  private shell: AbortController | null = null
  private detail: AbortController | null = null
  private earlier: Promise<boolean> | null = null
  private started = false
  private state: ChatOwnerSnapshot = {
    projection: createInitialChatProjectionSlice(),
    selectedSessionId: null,
    status: 'loading',
    detailLoading: false,
    loadingEarlier: false,
    error: null,
    pendingCommands: 0,
  }

  constructor(options: ChatOwnerOptions) {
    this.options = options
  }

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start() {
    if (this.started || this.lifetime.signal.aborted) return
    this.started = true
    void this.refresh()
  }

  clearError = () => this.publish({ error: null })

  async refresh() {
    if (this.lifetime.signal.aborted) return
    this.shell?.abort()
    this.detail?.abort()
    const controller = new AbortController()
    this.shell = controller
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    this.publish({ status: 'loading', error: null })
    try {
      const snapshot = await readChatShell(this.options.client, signal)
      this.project(syncChatProjectionShellSnapshot(this.state.projection, snapshot))
      this.publish({ status: 'ready' })
      void this.watchShell(controller)
      this.openSelectedSession()
    } catch (error) {
      if (signal.aborted) return
      this.fail(error, 'Chat sessions could not be loaded.', { operation: 'bootstrap' })
      this.publish({ status: 'failed', detailLoading: false })
    }
  }

  selectSession(sessionId: SessionId | null) {
    if (this.lifetime.signal.aborted) return
    if (sessionId === this.state.selectedSessionId && this.detail && !this.detail.signal.aborted)
      return
    this.detail?.abort()
    this.earlier = null
    this.publish({
      selectedSessionId: sessionId,
      detailLoading: false,
      loadingEarlier: false,
      error: null,
    })
    if (this.state.status === 'ready') this.openSelectedSession()
  }

  async dispatch(command: ClientOrchestrationCommand): Promise<OrchestrationDispatchResult> {
    this.lifetime.signal.throwIfAborted()
    this.publish({ pendingCommands: this.state.pendingCommands + 1, error: null })
    const startedAt = performance.now()
    const beforeSequence = this.state.projection.lastAppliedShellSequence
    let result: OrchestrationDispatchResult
    try {
      result = await this.dispatchWithRetry(command)
    } catch (error) {
      this.fail(error, 'Chat command failed.', {
        ...chatCommandSummary(command),
        operation: 'dispatch',
        durationMs: performance.now() - startedAt,
      })
      this.publish({ pendingCommands: this.state.pendingCommands - 1 })
      throw error
    }
    // Acceptance is durable even if its follow-up read fails; never invite a second send.
    await this.reconcile(command, beforeSequence)
    this.publish({ pendingCommands: this.state.pendingCommands - 1 })
    this.options.record?.({
      ...chatCommandSummary(command),
      action: 'chat.command.summary',
      outcome: 'accepted',
      deduped: result.deduped,
      sequence: result.sequence,
      durationMs: performance.now() - startedAt,
    })
    return result
  }

  loadEarlier(): Promise<boolean> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId || this.lifetime.signal.aborted) return Promise.resolve(false)
    if (!selectChatSessionHasEarlier(this.state.projection, sessionId))
      return Promise.resolve(false)
    if (this.earlier) return this.earlier
    this.earlier = this.readEarlier(sessionId)
    return this.earlier
  }

  async readTranscript(sessionId: SessionId): Promise<ChatSession> {
    const signal = this.lifetime.signal
    signal.throwIfAborted()
    const [shell, detail] = await Promise.all([
      readChatShell(this.options.client, signal),
      readChatSession(this.options.client, sessionId, signal),
    ])
    let projection = syncChatProjectionSessionDetailSnapshot(
      syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), shell),
      detail,
    )
    while (selectChatSessionHasEarlier(projection, sessionId)) {
      const input = chatSessionEarlierPageInput(projection, sessionId)
      const page = await this.options.rpc.sessionDetailPage(input)
      signal.throwIfAborted()
      projection = prependChatProjectionSessionDetailPage(projection, page)
      if (page.hasEarlier && !page.messages.length && !page.activities.length)
        throw createClientError({
          code: 'CHAT_HISTORY_STALLED',
          status: 502,
          message: 'Session history stopped before its first message.',
          why: 'The server reported earlier rows without returning any.',
          fix: 'Retry the export and inspect the session pagination response.',
        })
    }
    const session = selectChatSessionById(projection, sessionId)
    if (session) return session
    throw createClientError({
      code: 'CHAT_SESSION_MISSING',
      status: 404,
      message: 'The session is no longer available.',
      why: 'Its project or checkout was removed while reading its transcript.',
      fix: 'Refresh the session list.',
    })
  }

  dispose() {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort(createOrchestrationRpcClosedError())
    this.shell?.abort()
    this.detail?.abort()
    this.listeners.clear()
  }

  private publish(patch: Partial<ChatOwnerSnapshot>) {
    if (this.lifetime.signal.aborted) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private project(projection: ChatProjectionSlice) {
    if (projection === this.state.projection) return
    this.publish({ projection })
  }

  private openSelectedSession() {
    this.detail?.abort()
    this.detail = null
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    const controller = new AbortController()
    this.detail = controller
    this.publish({ detailLoading: true })
    void this.watchSession(sessionId, controller)
  }

  private async watchShell(controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    try {
      const stream = this.options.rpc.shellStream({
        afterSequence: this.state.projection.lastAppliedShellSequence,
        signal,
      })
      for await (const item of stream) {
        if (signal.aborted) return
        this.project(applyChatProjectionShellStreamItem(this.state.projection, item))
      }
    } catch (error) {
      if (signal.aborted) return
      this.fail(error, 'Chat session updates stopped. Reconnect to resume.', {
        operation: 'shell-stream',
      })
      this.publish({ status: 'failed' })
    }
  }

  private async watchSession(sessionId: SessionId, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    try {
      const snapshot = await readChatSession(this.options.client, sessionId, signal)
      this.project(syncChatProjectionSessionDetailSnapshot(this.state.projection, snapshot))
      this.publish({ detailLoading: false })
      const stream = this.options.rpc.sessionDetailStream(sessionId, {
        afterSequence: snapshot.snapshotSequence,
        signal,
      })
      for await (const item of stream) {
        if (signal.aborted) return
        this.project(applyChatProjectionSessionStreamItem(this.state.projection, item))
      }
    } catch (error) {
      if (signal.aborted) return
      this.fail(error, 'This session could not be loaded.', {
        operation: 'session-stream',
        sessionId,
      })
      this.publish({ detailLoading: false })
    }
  }

  private async dispatchWithRetry(command: ClientOrchestrationCommand) {
    try {
      return await this.options.rpc.dispatchCommand(command)
    } catch (error) {
      this.lifetime.signal.throwIfAborted()
      if (!retryableDispatch(error)) throw error
      return this.options.rpc.dispatchCommand(command)
    }
  }

  private async reconcile(command: ClientOrchestrationCommand, afterSequence: number) {
    if (this.lifetime.signal.aborted) return
    const signal = this.lifetime.signal
    const results = await Promise.allSettled([
      this.resnapshotShell(signal),
      ...commandSessions(command).map((sessionId) =>
        this.resnapshotSession(sessionId, afterSequence, signal),
      ),
    ])
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status !== 'rejected' || signal.aborted) return
    this.fail(
      failure.reason,
      'Command accepted; refreshing its result failed. Reconnect to refresh.',
      { ...chatCommandSummary(command), operation: 'reconcile' },
    )
  }

  private async resnapshotShell(signal: AbortSignal) {
    const snapshot = await readChatShell(this.options.client, signal)
    this.project(syncChatProjectionShellSnapshot(this.state.projection, snapshot))
  }

  private async resnapshotSession(
    sessionId: SessionId,
    afterSequence: number,
    signal: AbortSignal,
  ) {
    const detailSequence = this.state.projection.sessionDetailSequenceById[sessionId] ?? 0
    const snapshot = await readChatSession(this.options.client, sessionId, signal)
    signal.throwIfAborted()
    // Read replay after the snapshot so its last page covers any history replacement in that snapshot.
    const replay = await this.options.rpc
      .replayEvents({ afterSequence: Math.min(afterSequence, detailSequence), sessionId })
      .catch(() => null)
    signal.throwIfAborted()
    const preserveEarlier =
      replay !== null &&
      replay.events.length < ORCHESTRATION_REPLAY_MAX_EVENTS &&
      !replay.events.some((event) => event.type === 'session.history-imported')
    this.project(
      syncChatProjectionSessionDetailSnapshot(
        this.state.projection,
        snapshot,
        preserveEarlier ? 'reconcile' : 'replace',
      ),
    )
    if (replay) this.project(applyChatProjectionEvents(this.state.projection, replay.events))
  }

  private async readEarlier(sessionId: SessionId) {
    this.publish({ loadingEarlier: true, error: null })
    try {
      const page = await this.options.rpc.sessionDetailPage(
        chatSessionEarlierPageInput(this.state.projection, sessionId),
      )
      this.project(prependChatProjectionSessionDetailPage(this.state.projection, page))
      return !this.lifetime.signal.aborted
    } catch (error) {
      if (sessionId === this.state.selectedSessionId)
        this.fail(error, 'Earlier messages could not be loaded.', {
          operation: 'earlier',
          sessionId,
        })
      return false
    } finally {
      if (sessionId === this.state.selectedSessionId) {
        this.earlier = null
        this.publish({ loadingEarlier: false })
      }
    }
  }

  private fail(error: unknown, fallback: string, context: Record<string, unknown>) {
    this.publish({ error: errorStringField(error, 'message') ?? fallback })
    this.options.record?.({
      ...context,
      action: 'chat.operation.summary',
      outcome: 'failed',
      error,
    })
  }
}

function commandSessions(command: ClientOrchestrationCommand): SessionId[] {
  if (!('sessionId' in command) || command.type === 'session.delete') return []
  const ids = [command.sessionId]
  if (command.type === 'session.turn.start' && command.sourceProposedPlan)
    ids.push(command.sourceProposedPlan.sessionId)
  return [...new Set(ids)]
}

function retryableDispatch(error: unknown) {
  const code = errorStringField(error, 'code')
  return (
    code === 'ORCHESTRATION_RPC_TIMEOUT' ||
    code === 'ORCHESTRATION_WS_CLOSED' ||
    code === 'ORCHESTRATION_WS_ERROR' ||
    code === 'ORCHESTRATION_WS_HEARTBEAT_TIMEOUT'
  )
}
