import { elapsedMs } from '@workspace/utils/timing'
import {
  ORCHESTRATION_WS_RESULTS,
  errorStringField,
  orchestrationShellStreamItemSchema,
  orchestrationSessionStreamItemSchema,
  orchestrationWsServerMessageSchema,
  type ClientOrchestrationCommand,
  type OrchestrationReplayEventsInput,
  type OrchestrationWsClientMessage,
  type OrchestrationWsError,
  type OrchestrationWsRequest,
  type OrchestrationWsRequestOf,
  type OrchestrationWsServerMessage,
  type OrchestrationWsSubscribe,
  type OrchestrationWsSubscriptionId,
  type OrchestrationWsSessionDetailPageInput,
  type SessionId,
} from '@workspace/contracts'
import * as v from 'valibot'

import { canonicalServerOrigin } from './client'
import { AsyncSubscriptionQueue, drainSubscriptionQueue } from './subscription-queue'
import type { createEnvironmentsStore } from '../environments/state/store'
import { createClientError } from '../errors'
import { createOrchestrationRpcClosedError } from './structured-errors'
import { chatCommandSummary } from '@workspace/contracts'
import { orchestrationReplaySummary as chatReplaySummary } from '@workspace/contracts'
import {
  guardOrchestrationStreamSequence,
  orchestrationStreamItemSequence,
  type OrchestrationStreamItem,
} from './utils/sequence'
import type { OrchestrationStreamInput } from './streams'
import type {
  OrchestrationSocket,
  OrchestrationSocketEvents,
  RpcEventScope,
  RpcObservation,
} from './rpc-host'

const serverError = Symbol('orchestration RPC server response')

export function isOrchestrationRpcServerError(error: unknown) {
  return error !== null && typeof error === 'object' && serverError in error
}

const ORCHESTRATION_RPC_CONNECT_TIMEOUT_MS = 10_000
const ORCHESTRATION_RPC_REQUEST_TIMEOUT_MS = 60_000
const ORCHESTRATION_RPC_HEARTBEAT_MS = 30_000
const ORCHESTRATION_RPC_HEARTBEAT_TIMEOUT_MS = 10_000
/** Past this, an answer is late enough that the UI should stop pretending it is instant. */
const ORCHESTRATION_RPC_SLOW_REQUEST_MS = 4_000

type PendingRequest = {
  method: OrchestrationWsRequest['method']
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  slowTimeoutId: ReturnType<typeof setTimeout>
  startedAt: number
  timeoutId: ReturnType<typeof setTimeout>
}

type RpcSubscription = {
  method: OrchestrationWsSubscribe['method']
  queue: Pick<AsyncSubscriptionQueue<unknown>, 'close' | 'fail'>
  accept: (item: unknown, deliveryId: number) => void
  synchronize: (sequence: number, deliveryId: number) => void
  scope: RpcEventScope
  sessionId?: SessionId
}

/** Whether the host's window is visible and focused, and a way to hear when that changes. */
export type OrchestrationPresenceSource = {
  readonly focused: () => boolean
  readonly subscribe: (listener: () => void) => () => void
}

export type OrchestrationRpcClientOptions = {
  readonly createSocket: (url: string) => OrchestrationSocket
  /**
   * Maps the environment origin to the address the socket really opens (a
   * machine proxy, say). Resolved here so the connection log names that address.
   */
  readonly resolveEndpoint?: (origin: string) => string
  readonly environments: ReturnType<typeof createEnvironmentsStore>
  readonly observation: RpcObservation
  readonly onDisconnect?: (error: unknown) => void
  /**
   * The host's latency dial, run before each request or subscription is sent.
   * Returning nothing keeps the send synchronous up to the socket, which the
   * transport tests depend on when the dial is off.
   */
  readonly beforeRequest?: () => Promise<void> | undefined
  /** Reported to the server, which holds push notices while a window is focused. */
  readonly presence?: OrchestrationPresenceSource
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  slowRequestMs?: number
  readonly origin: string
}

export class OrchestrationRpcClient {
  private closedError: ReturnType<typeof createOrchestrationRpcClosedError> | null = null
  private handshakeReceived = false
  private rejectOpening: ((error: unknown) => void) | null = null
  private resolveOpening: (() => void) | null = null
  private heartbeatId: ReturnType<typeof setInterval> | null = null
  private opening: Promise<OrchestrationSocket> | null = null
  private pendingPingRequestId: string | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private pongTimeoutId: ReturnType<typeof setTimeout> | null = null
  private requestCounter = 0
  private readonly requestPrefix = crypto.randomUUID()
  private socket: OrchestrationSocket | null = null
  private socketError: unknown = null
  private socketScope: RpcEventScope | null = null
  private subscriptionCounter = 0
  private subscriptions = new Map<OrchestrationWsSubscriptionId, RpcSubscription>()
  private reportedPresence: boolean | null = null
  private readonly stopPresence: (() => void) | null

  private readonly options: OrchestrationRpcClientOptions

  constructor(options: OrchestrationRpcClientOptions) {
    this.options = { ...options, origin: canonicalServerOrigin(options.origin) }
    this.stopPresence = options.presence?.subscribe(() => this.reportPresence()) ?? null
  }

  get closed() {
    return this.closedError !== null
  }

  async ready(): Promise<void> {
    await this.connect()
  }

  close() {
    if (this.closedError) return

    const error = createOrchestrationRpcClosedError()
    this.closedError = error
    this.stopPresence?.()
    this.rejectOpening?.(error)
    const socket = this.socket
    if (socket) {
      this.teardownSocket(socket, error, { explicitlyClosed: true })
      socket.close()
    }
    this.stopHeartbeat()
    this.rejectPendingRequests(error)
    this.failSubscriptions(error)
  }

  dispatchCommand(command: ClientOrchestrationCommand) {
    return this.options.observation.observeOperation(
      {
        action: 'chat.command.rpc',
        area: 'chat',
        ...chatCommandSummary(command),
      },
      async () => {
        const request: OrchestrationWsRequestOf<'dispatchCommand'> = {
          command,
          kind: 'request',
          method: 'dispatchCommand',
          requestId: this.nextRequestId('dispatchCommand'),
        }

        return this.sendRequest(request, ORCHESTRATION_WS_RESULTS.dispatchCommand)
      },
      (result) => ({
        deduped: result.deduped,
        sequence: result.sequence,
      }),
    )
  }

  sessionDetailPage(input: OrchestrationWsSessionDetailPageInput) {
    return this.options.observation.observeOperation(
      {
        action: 'chat.session_detail_page.rpc',
        area: 'chat',
        // The boundary tells a first page from a continuation; the anchor ids
        // themselves say nothing a reader of the log needs.
        fromActivityAnchor: Boolean(input.beforeActivity),
        fromMessageAnchor: Boolean(input.beforeMessage),
        sessionId: input.sessionId,
      },
      async () => {
        const request: OrchestrationWsRequestOf<'sessionDetailPage'> = {
          input,
          kind: 'request',
          method: 'sessionDetailPage',
          requestId: this.nextRequestId('sessionDetailPage'),
        }

        return this.sendRequest(request, ORCHESTRATION_WS_RESULTS.sessionDetailPage)
      },
      (page) => ({
        activityCount: page.activities.length,
        hasEarlier: page.hasEarlier,
        messageCount: page.messages.length,
        snapshotSequence: page.snapshotSequence,
      }),
    )
  }

  replayEvents(input: OrchestrationReplayEventsInput) {
    return this.options.observation.observeOperation(
      {
        action: 'chat.replay.rpc',
        area: 'chat',
        ...chatReplaySummary(input),
      },
      async () => {
        const request: OrchestrationWsRequestOf<'replayEvents'> = {
          input,
          kind: 'request',
          method: 'replayEvents',
          requestId: this.nextRequestId('replayEvents'),
        }

        return this.sendRequest(request, ORCHESTRATION_WS_RESULTS.replayEvents)
      },
      (result) => ({
        eventCount: result.events.length,
        eventTypes: result.events.map((event) => event.type),
        maxSequence: result.events.at(-1)?.sequence ?? input.afterSequence,
      }),
    )
  }

  async *shellStream(input: OrchestrationStreamInput = {}) {
    const afterSequence = input.afterSequence ?? 0
    const subscription: OrchestrationWsSubscribe = {
      afterSequence,
      kind: 'subscribe',
      method: 'subscribeShell',
      subscriptionId: this.nextSubscriptionId('shell'),
    }
    const stream = this.subscribeRecovering(subscription, input, orchestrationShellStreamItemSchema)

    yield* guardOrchestrationStreamSequence(stream, streamGuardSequence(input.afterSequence))
  }

  async *sessionDetailStream(sessionId: SessionId, input: OrchestrationStreamInput = {}) {
    const afterSequence = input.afterSequence ?? 0
    const subscription: OrchestrationWsSubscribe = {
      afterSequence,
      kind: 'subscribe',
      method: 'subscribeSession',
      subscriptionId: this.nextSubscriptionId('session'),
      sessionId,
    }
    const stream = this.subscribeRecovering(
      subscription,
      input,
      orchestrationSessionStreamItemSchema,
    )

    yield* guardOrchestrationStreamSequence(stream, streamGuardSequence(input.afterSequence))
  }

  // Response envelopes omit the method; the sent request supplies its result type.
  private async sendRequest<TSchema extends v.GenericSchema>(
    message: OrchestrationWsRequest,
    resultSchema: TSchema,
  ): Promise<v.InferOutput<TSchema>> {
    const delay = this.options.beforeRequest?.()
    if (delay) await delay
    const socket = await this.connect()

    return new Promise<v.InferOutput<TSchema>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.settlePendingRequest(message.requestId)
        reject(createOrchestrationRpcTimeoutError(message.method))
      }, ORCHESTRATION_RPC_REQUEST_TIMEOUT_MS)
      // One flat timeout cannot tell a slow answer from a stuck one, so a
      // request that overruns says so long before it is allowed to fail.
      const slowTimeoutId = setTimeout(() => {
        this.options.environments.getState().markSlowRequest(this.options.origin, message.requestId)
        this.socketScope?.increment('request.slowCount')
      }, this.options.slowRequestMs ?? ORCHESTRATION_RPC_SLOW_REQUEST_MS)

      this.pendingRequests.set(message.requestId, {
        method: message.method,
        reject,
        resolve: (value) => settleParsedResult({ value, schema: resultSchema, resolve, reject }),
        slowTimeoutId,
        startedAt: performance.now(),
        timeoutId,
      })
      try {
        this.sendSocketMessage(socket, message)
      } catch (error) {
        this.settlePendingRequest(message.requestId)
        reject(error)
      }
    })
  }

  /** Single exit for a request's bookkeeping, however it ends. */
  private settlePendingRequest(requestId: string) {
    const pending = this.pendingRequests.get(requestId)
    this.pendingRequests.delete(requestId)
    if (pending) {
      clearTimeout(pending.timeoutId)
      clearTimeout(pending.slowTimeoutId)
    }
    this.options.environments.getState().clearSlowRequest(this.options.origin, requestId)

    return pending
  }

  private async *subscribeRecovering<
    TSchema extends v.GenericSchema<unknown, OrchestrationStreamItem>,
  >(message: OrchestrationWsSubscribe, input: OrchestrationStreamInput, schema: TSchema) {
    const recovery: SubscriptionRecovery = {
      afterSequence: message.afterSequence,
      attempt: 0,
      failedCursor: undefined,
    }
    while (!input.signal?.aborted) {
      const current = {
        ...message,
        afterSequence: recovery.afterSequence,
        subscriptionId: this.nextSubscriptionId(message.method),
      }
      const failure = yield* this.consumeSubscription(current, input, schema, recovery)
      if (!failure || input.signal?.aborted) return
      if (errorStringField(failure.error, 'code') !== 'orchestration.LIVE_STREAM_OVERFLOW')
        throw failure.error
      await waitForSubscriptionRetry(advanceSubscriptionRetry(recovery), input.signal)
    }
  }

  private async *consumeSubscription<
    TSchema extends v.GenericSchema<unknown, OrchestrationStreamItem>,
  >(
    message: OrchestrationWsSubscribe,
    input: OrchestrationStreamInput,
    schema: TSchema,
    recovery: SubscriptionRecovery,
  ) {
    try {
      for await (const item of this.subscribe(message, input, schema)) {
        yield item
        recordSubscriptionConsumption(recovery, item)
      }
      return null
    } catch (error) {
      return { error }
    }
  }

  private async *subscribe<TSchema extends v.GenericSchema>(
    message: OrchestrationWsSubscribe,
    { signal, onSynchronized }: OrchestrationStreamInput,
    schema: TSchema,
  ) {
    if (signal?.aborted) return

    const acknowledge = (deliveryId: number) =>
      this.sendClientMessageIfOpen({
        kind: 'subscription.ack',
        subscriptionId: message.subscriptionId,
        deliveryId,
      })
    const queue = new AsyncSubscriptionQueue<SubscriptionItem<v.InferOutput<TSchema>>>({
      // Snapshot recovery is one ACK-gated frame, outside the live-event byte budget.
      isSnapshot: (frame) => frame.kind === 'data' && isSnapshotFrame(frame.item),
      onOverflow: () =>
        this.sendClientMessageIfOpen({
          kind: 'unsubscribe',
          subscriptionId: message.subscriptionId,
        }),
    })
    const sessionId = message.method === 'subscribeSession' ? message.sessionId : undefined
    const scope = this.options.observation.createScope({
      action: 'orchestration.ws.subscription.summary',
      afterSequence: message.afterSequence,
      area: 'orchestration',
      method: message.method,
      subscriptionId: message.subscriptionId,
      sessionId,
    })
    const subscription: RpcSubscription = {
      method: message.method,
      queue,
      accept: (value, deliveryId) =>
        settleParsedResult({
          value,
          schema,
          resolve: (item) => queue.push({ kind: 'data', item, deliveryId }),
          reject: (error) => queue.fail(error),
        }),
      synchronize: (sequence, deliveryId) =>
        queue.push({ kind: 'synchronized', sequence, deliveryId }),
      scope,
      sessionId,
    }
    this.subscriptions.set(message.subscriptionId, subscription)
    const abort = () => {
      queue.close()
      this.subscriptions.delete(message.subscriptionId)
      this.sendClientMessageIfOpen({ kind: 'unsubscribe', subscriptionId: message.subscriptionId })
    }

    try {
      signal?.addEventListener('abort', abort, { once: true })
      await this.sendClientMessage(message)
      scope.increment('subscription.openCount')
      yield* drainSubscriptionItems(queue, onSynchronized, acknowledge)
    } catch (error) {
      if (error !== this.closedError) scope.error(error)
      if (!signal?.aborted) throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      this.subscriptions.delete(message.subscriptionId)
      this.sendClientMessageIfOpen({
        kind: 'unsubscribe',
        subscriptionId: message.subscriptionId,
      })
      scope.increment('subscription.closeCount')
      scope.end({
        aborted: signal?.aborted ?? false,
        explicitlyClosed: this.closed,
      })
    }
  }

  private async connect(): Promise<OrchestrationSocket> {
    if (this.closedError) throw this.closedError

    const open = this.openSocket()
    if (open) return open
    if (this.opening) return this.opening

    const { origin, resolveEndpoint } = this.options
    const url = orchestrationRpcUrl(resolveEndpoint?.(origin) ?? origin)
    const socket = this.options.createSocket(url)
    this.socket = socket
    this.socketError = null
    this.handshakeReceived = false
    this.socketScope = this.options.observation.createScope({
      action: 'orchestration.ws.connection.summary',
      area: 'orchestration',
      origin,
      url,
    })
    this.opening = this.openSocketConnection(socket)

    return this.opening
  }

  private openSocketConnection(socket: OrchestrationSocket) {
    return new Promise<OrchestrationSocket>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.teardownSocket(socket, createOrchestrationRpcConnectTimeoutError(), {
          connectTimedOut: true,
        })
        socket.close()
      }, ORCHESTRATION_RPC_CONNECT_TIMEOUT_MS)
      this.rejectOpening = (error) => {
        clearTimeout(timeoutId)
        this.opening = null
        this.rejectOpening = null
        this.resolveOpening = null
        reject(error)
      }
      this.resolveOpening = () => {
        clearTimeout(timeoutId)
        this.opening = null
        this.rejectOpening = null
        this.resolveOpening = null
        this.startHeartbeat(socket)
        resolve(socket)
      }
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return
        this.socketScope?.increment('socket.openCount')
      })
      socket.addEventListener('message', (event) => {
        if (this.socket !== socket) return
        this.handleSocketMessage(socket, event)
      })
      let transportError = false
      socket.addEventListener('error', (event) => {
        if (this.socket !== socket) return
        transportError = true
        this.socketScope?.warn('Orchestration WebSocket transport error.', {
          eventType: event.type,
        })
        // Teardown waits for the `close` that always follows: it carries the code and `wasClean`.
        socket.close()
      })
      socket.addEventListener('close', (event) => {
        const error = transportError
          ? createOrchestrationRpcSocketError()
          : createOrchestrationRpcCloseError(event)
        this.handleSocketClose(socket, event, error, transportError)
      })
    })
  }

  private openSocket() {
    if (this.closed || !this.handshakeReceived) return null

    if (this.socket?.readyState === 1) return this.socket

    return null
  }

  private async sendClientMessage(message: OrchestrationWsClientMessage) {
    const delay = this.options.beforeRequest?.()
    if (delay) await delay
    const socket = await this.connect()

    this.sendSocketMessage(socket, message)
  }

  private sendClientMessageIfOpen(message: OrchestrationWsClientMessage) {
    const socket = this.openSocket()
    if (!socket) return

    this.sendSocketMessage(socket, message)
  }

  private sendSocketMessage(socket: OrchestrationSocket, message: OrchestrationWsClientMessage) {
    if (this.closedError) throw this.closedError
    if (this.socket !== socket) throw this.socketError ?? createOrchestrationRpcSocketError()

    try {
      socket.send(JSON.stringify(message))
    } catch (error) {
      socket.close()
      throw error
    }
  }

  private handleSocketMessage(
    socket: OrchestrationSocket,
    event: OrchestrationSocketEvents['message'],
  ) {
    const message = this.parseSocketMessage(event.data)
    if (!message) return
    if (message.kind === 'connected') {
      // The first frame on an authenticated connection, and the only place the
      // client learns which server process it is talking to.
      try {
        this.options.environments.getState().recordHandshake(this.options.origin, message.config)
      } catch (error) {
        this.teardownSocket(socket, error, { identityRefused: true })
        socket.close()
        return
      }
      this.handshakeReceived = true
      this.resolveOpening?.()
      this.socketScope?.set({
        environmentId: message.config.environmentId,
        protocolVersion: message.config.protocolVersion,
        serverInstanceId: message.config.serverInstanceId,
      })
      this.reportPresence()
      return
    }
    if (!this.handshakeReceived) return
    if (message.kind === 'response') {
      this.handleResponseMessage(message)
      return
    }

    if (message.kind === 'subscription.next') {
      this.handleSubscriptionNext(message)
      return
    }

    if (message.kind === 'subscription.error') {
      this.handleSubscriptionError(message)
      return
    }

    if (message.kind === 'pong') {
      this.handlePongMessage(message.requestId)
      return
    }

    if (message.kind === 'subscription.complete') {
      this.subscriptions.get(message.subscriptionId)?.queue.close()
    }
  }

  private reportPresence(refresh = false) {
    const presence = this.options.presence
    if (!presence) return
    const focused = presence.focused()
    if ((!refresh && focused === this.reportedPresence) || !this.openSocket()) return
    try {
      this.sendClientMessageIfOpen({ kind: 'presence', focused })
      this.reportedPresence = focused
    } catch {
      // A failed send closes the socket, and the next handshake reports again.
    }
  }

  private handleResponseMessage(
    message: Extract<OrchestrationWsServerMessage, { kind: 'response' }>,
  ) {
    const pending = this.settlePendingRequest(message.requestId)
    if (!pending) return

    this.socketScope?.increment('response.count')
    this.socketScope?.increment(message.ok ? 'response.okCount' : 'response.errorCount')
    this.socketScope?.set({
      response: {
        latestDurationMs: elapsedMs(pending.startedAt),
        latestMethod: pending.method,
        latestOk: message.ok,
      },
    })
    if (message.ok) {
      pending.resolve(message.data)
      return
    }

    pending.reject(createOrchestrationRpcServerError(message.error))
  }

  private handleSubscriptionNext(
    message: Extract<OrchestrationWsServerMessage, { kind: 'subscription.next' }>,
  ) {
    const subscription = this.subscriptions.get(message.subscriptionId)
    if (!subscription) return

    subscription.scope.increment('subscription.nextCount')
    if (message.item.kind === 'synchronized') {
      subscription.scope.set({ synchronizedSequence: message.item.sequence })
      subscription.synchronize(message.item.sequence, message.deliveryId)
      return
    }
    subscription.accept(message.item, message.deliveryId)
  }

  private handleSubscriptionError(
    message: Extract<OrchestrationWsServerMessage, { kind: 'subscription.error' }>,
  ) {
    const subscription = this.subscriptions.get(message.subscriptionId)
    if (!subscription) return

    subscription.scope.error(createOrchestrationRpcServerError(message.error), {
      code: message.error.code,
      status: message.error.status,
    })
    subscription.queue.fail(createOrchestrationRpcServerError(message.error))
  }

  private handleSocketClose(
    socket: OrchestrationSocket,
    event: OrchestrationSocketEvents['close'],
    error: unknown,
    transportError: boolean,
  ) {
    this.teardownSocket(socket, error, {
      code: event.code,
      reason: event.reason,
      transportError,
      wasClean: event.wasClean,
    })
  }

  // Every owner must settle when its socket dies, including a connection still opening.
  private teardownSocket(
    socket: OrchestrationSocket,
    error: unknown,
    summary: Record<string, unknown>,
  ) {
    if (this.socket !== socket) return

    this.socketError = error
    this.rejectOpening?.(error)
    this.socket = null
    this.handshakeReceived = false
    this.reportedPresence = null
    this.opening = null
    this.stopHeartbeat()
    this.options.environments.getState().markDisconnected(this.options.origin)
    const scope = this.socketScope
    this.socketScope = null
    this.rejectPendingRequests(error)
    this.failSubscriptions(error)
    scope?.increment('socket.closeCount')
    scope?.end(summary)
    if (!this.closed) this.notifyDisconnect(error)
  }

  private notifyDisconnect(error: unknown) {
    try {
      this.options.onDisconnect?.(error)
    } catch {
      // A host callback must not prevent the socket from closing.
    }
  }

  private rejectPendingRequests(error: unknown) {
    const requestIds = [...this.pendingRequests.keys()]

    for (const requestId of requestIds) {
      this.settlePendingRequest(requestId)?.reject(error)
    }
  }

  private failSubscriptions(error: unknown) {
    const subscriptions = [...this.subscriptions.values()]

    for (const subscription of subscriptions) {
      subscription.queue.fail(error)
    }
  }

  private parseSocketMessage(data: unknown): OrchestrationWsServerMessage | null {
    if (typeof data !== 'string') {
      this.socketScope?.increment('message.invalidCount')
      this.socketScope?.warn('Invalid orchestration WebSocket message.', {
        reason: 'non_string_message',
      })
      return null
    }

    try {
      return v.parse(orchestrationWsServerMessageSchema, JSON.parse(data))
    } catch (error) {
      this.socketScope?.increment('message.invalidCount')
      this.socketScope?.warn('Invalid orchestration WebSocket message.', { error })
      return null
    }
  }

  private startHeartbeat(socket: OrchestrationSocket) {
    this.stopHeartbeat()
    this.heartbeatId = setInterval(
      () => this.sendHeartbeat(socket),
      this.options.heartbeatIntervalMs ?? ORCHESTRATION_RPC_HEARTBEAT_MS,
    )
  }

  // A half-open socket stays OPEN while starving subscriptions; an unanswered ping closes it.
  private sendHeartbeat(socket: OrchestrationSocket) {
    if (this.socket !== socket) return
    if (this.pendingPingRequestId !== null) return

    this.reportPresence(true)
    const requestId = this.nextRequestId('ping')
    this.pendingPingRequestId = requestId
    this.pongTimeoutId = setTimeout(
      () => this.failSocketLiveness(socket, requestId),
      this.options.heartbeatTimeoutMs ?? ORCHESTRATION_RPC_HEARTBEAT_TIMEOUT_MS,
    )
    this.socketScope?.increment('heartbeat.pingCount')
    this.sendClientMessageIfOpen({ kind: 'ping', requestId })
  }

  private handlePongMessage(requestId: string) {
    if (this.pendingPingRequestId !== requestId) return

    this.clearPendingPing()
    this.socketScope?.increment('heartbeat.pongCount')
  }

  private failSocketLiveness(socket: OrchestrationSocket, requestId: string) {
    if (this.socket !== socket) return
    if (this.pendingPingRequestId !== requestId) return

    this.socketScope?.increment('heartbeat.timeoutCount')
    this.socketScope?.warn('Orchestration WebSocket heartbeat went unanswered.', { requestId })
    this.teardownSocket(socket, createOrchestrationRpcHeartbeatTimeoutError(), {
      heartbeatTimedOut: true,
      requestId,
    })
    socket.close()
  }

  private stopHeartbeat() {
    this.clearPendingPing()
    if (this.heartbeatId === null) return

    clearInterval(this.heartbeatId)
    this.heartbeatId = null
  }

  private clearPendingPing() {
    this.pendingPingRequestId = null
    if (this.pongTimeoutId === null) return

    clearTimeout(this.pongTimeoutId)
    this.pongTimeoutId = null
  }

  private nextRequestId(method: string) {
    this.requestCounter += 1

    return `orpc-${method}-${this.requestPrefix}-${this.requestCounter}`
  }

  private nextSubscriptionId(kind: string) {
    this.subscriptionCounter += 1

    return `osub-${kind}-${this.subscriptionCounter}`
  }
}

// Appended, not resolved against the root: an origin may carry a base path
// (`/platform`, a machine proxy prefix) that the socket must keep.
function orchestrationRpcUrl(origin: string) {
  const url = new URL(`${origin.replace(/\/+$/u, '')}/orchestration/rpc`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  return url.toString()
}

function streamGuardSequence(afterSequence: number | undefined) {
  return afterSequence === undefined ? -1 : afterSequence - 1
}

function createOrchestrationRpcServerError(error: OrchestrationWsError) {
  return Object.assign(
    createClientError({
      cause: error,
      code: error.code ?? 'client.RPC_FAILED',
      message: error.message,
      status: error.status ?? 502,
      why: 'The server returned an error response for a client RPC call.',
      fix: 'Inspect the structured RPC payload and retry once the server issue is resolved.',
    }),
    { [serverError]: true },
  )
}

function createOrchestrationRpcTimeoutError(method: string) {
  return createClientError({
    code: 'ORCHESTRATION_RPC_TIMEOUT',
    message: `Orchestration RPC request timed out: ${method}`,
    status: 504,
    why: 'The server did not answer the orchestration WebSocket request before the client timeout.',
    fix: 'Inspect the chat pipeline logs and retry after the server is responsive.',
  })
}

function createOrchestrationRpcConnectTimeoutError() {
  return createClientError({
    code: 'ORCHESTRATION_WS_CONNECT_TIMEOUT',
    message: 'Timed out opening the orchestration WebSocket.',
    status: 504,
    why: 'The client could not establish the orchestration RPC socket in time.',
    fix: 'Verify the server is running and accepting WebSocket upgrades.',
  })
}

function createOrchestrationRpcSocketError() {
  return createClientError({
    code: 'ORCHESTRATION_WS_ERROR',
    message: 'The orchestration WebSocket reported a transport error.',
    status: 502,
    why: 'The client socket failed before the server returned a usable response.',
    fix: 'Inspect client and server logs for the WebSocket failure.',
  })
}

function createOrchestrationRpcCloseError(event: OrchestrationSocketEvents['close']) {
  if (event.code === 1008) {
    return createClientError({
      code: 'ORCHESTRATION_WS_UNAUTHORIZED',
      message: 'The orchestration WebSocket was rejected by the server.',
      status: 401,
      why: 'The server closed the WebSocket because the connection is unauthorized.',
      fix: 'Sign in again or fix the server auth configuration; retrying the socket will not help.',
    })
  }

  return createClientError({
    code: 'ORCHESTRATION_WS_CLOSED',
    message: 'The orchestration WebSocket closed before the request completed.',
    status: event.wasClean ? 499 : 502,
    why: 'The shared orchestration RPC connection closed while work was still in flight.',
    fix: 'Reconnect the chat view and inspect the server WebSocket logs if it repeats.',
  })
}

function createOrchestrationRpcHeartbeatTimeoutError() {
  return createClientError({
    code: 'ORCHESTRATION_WS_HEARTBEAT_TIMEOUT',
    message: 'The orchestration WebSocket stopped answering heartbeats.',
    status: 504,
    why: 'The socket stayed open but the server never answered a ping, so it is half-open.',
    fix: 'Let the chat supervisors reconnect; inspect the server if heartbeats keep timing out.',
  })
}

function settleParsedResult<TSchema extends v.GenericSchema>({
  value,
  schema,
  resolve,
  reject,
}: {
  value: unknown
  schema: TSchema
  resolve: (result: v.InferOutput<TSchema>) => void
  reject: (error: unknown) => void
}) {
  const parsed = v.safeParse(schema, value)
  if (parsed.success) {
    resolve(parsed.output)
    return
  }
  reject(
    createClientError({
      code: 'ORCHESTRATION_RPC_INVALID_RESULT',
      message: 'The orchestration server returned an invalid result.',
      status: 502,
      why: 'The response did not match the requested operation or subscription schema.',
      fix: 'Check the server and client versions and inspect the orchestration logs.',
      cause: parsed.issues,
    }),
  )
}

type SubscriptionItem<T> =
  | { readonly kind: 'data'; readonly item: T; readonly deliveryId: number }
  | { readonly kind: 'synchronized'; readonly sequence: number; readonly deliveryId: number }

async function* drainSubscriptionItems<T>(
  queue: AsyncSubscriptionQueue<SubscriptionItem<T>>,
  onSynchronized: (() => void) | undefined,
  acknowledge: (deliveryId: number) => void,
) {
  for await (const frame of drainSubscriptionQueue(queue)) {
    if (frame.kind === 'synchronized') {
      onSynchronized?.()
      acknowledge(frame.deliveryId)
      continue
    }
    yield frame.item
    acknowledge(frame.deliveryId)
  }
}

function isSnapshotFrame(value: unknown) {
  return value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'snapshot'
}

function waitForSubscriptionRetry(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, delay)
    signal?.addEventListener('abort', done, { once: true })
    if (signal?.aborted) done()
  })
}

type SubscriptionRecovery = {
  afterSequence: number
  attempt: number
  failedCursor: number | undefined
}

function recordSubscriptionConsumption(
  recovery: SubscriptionRecovery,
  item: OrchestrationStreamItem,
) {
  const sequence = orchestrationStreamItemSequence(item)
  if (sequence > recovery.afterSequence) recovery.failedCursor = undefined
  recovery.afterSequence = sequence
  recovery.attempt = 0
}

function advanceSubscriptionRetry(recovery: SubscriptionRecovery) {
  // An oversized replay cannot pass the live client budget; recover it as a snapshot.
  const cursor = recovery.afterSequence
  if (recovery.failedCursor === cursor) recovery.afterSequence = 0
  recovery.failedCursor = cursor
  recovery.attempt += 1
  return Math.min(100 * 2 ** Math.min(recovery.attempt - 1, 5), 2_000)
}
