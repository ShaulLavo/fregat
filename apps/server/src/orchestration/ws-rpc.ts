import { isLiveStreamAckTimeout, LiveStreamBudget } from './live-stream-budget'
import { errorSummary as serializeOrchestrationRpcError } from '@workspace/contracts'
import { adaptWebSocket, isAbnormalWebSocketClose } from '../utils/websocket'
import { elapsedMs } from '@workspace/utils/timing'
import { isRecord } from '@workspace/utils/objects'
import {
  ORCHESTRATION_REPLAY_MAX_EVENTS,
  ORCHESTRATION_RESUME_MAX_GAP,
  ORCHESTRATION_WS_PROTOCOL_VERSION,
  type OrchestrationShellStreamFrame,
  type OrchestrationSessionStreamFrame,
  type OrchestrationWsServerConfig,
  orchestrationWsClientMessageSchema,
  type OrchestrationSessionDetailPage,
  type OrchestrationWsClientMessage,
  type OrchestrationWsRequest,
  type OrchestrationWsRequestOf,
  type OrchestrationWsResult,
  type OrchestrationWsServerMessage,
  type OrchestrationWsSubscribe,
  type OrchestrationWsSubscriptionId,
} from '@workspace/contracts'
import { Elysia } from 'elysia'

import serverPackage from '../../package.json' with { type: 'json' }
import { authenticateWebSocketData, type AuthConfig } from '../auth'
import type { EnvironmentIdentity } from '../db/environment-identity'
import {
  orchestrationCommandSummary,
  recordChatPipelineInfo,
  recordChatPipelineWarning,
} from './orchestration-logging'
import { orchestrationReplaySummary } from '@workspace/contracts'
import type { OrchestrationEngine } from './engine'
import type { ServerUpdate } from '../update/service'

/**
 * Identity of this server process. `serverInstanceId` changes on every restart,
 * which is how a reconnecting client learns that its resume cursor belongs to a
 * server generation that no longer holds a live tail for it.
 */
const SERVER_INSTANCE_ID = crypto.randomUUID()
const SERVER_STARTED_AT = new Date().toISOString()
const ACK_TIMEOUT_MS = 30_000
// Private-use code: the client files it in its failure series, which warns once per series.
const ACK_TIMEOUT_CLOSE_CODE = 4408
const ACK_TIMEOUT_CLOSE_REASON = 'live-stream-ack-timeout'

export function orchestrationWsServerConfig(
  identity: EnvironmentIdentity,
): OrchestrationWsServerConfig {
  return {
    environmentId: identity.id,
    capabilities: {
      resume: true,
      synchronizedMarker: true,
    },
    limits: {
      replayMaxEvents: ORCHESTRATION_REPLAY_MAX_EVENTS,
      resumeMaxGap: ORCHESTRATION_RESUME_MAX_GAP,
    },
    protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
    serverInstanceId: SERVER_INSTANCE_ID,
    serverVersion: serverPackage.version,
    startedAt: SERVER_STARTED_AT,
  }
}

type OrchestrationRpcWebSocket = {
  close(code?: number, reason?: string): unknown
  data: unknown
  key: object
  send(message: string): unknown
}

type ConnectionLogContext = { client?: { instanceId: string } }

type OrchestrationRpcConnectionState = {
  log: ConnectionLogContext
  nextDeliveryId: number
  openedAt: number
  serverCloseReason: string | null
  subscriptions: Map<OrchestrationWsSubscriptionId, OrchestrationRpcSubscription>
  unsubscribeUpdate: () => void
}

type OrchestrationRpcSubscription = {
  abortController: AbortController
  budget: LiveStreamBudget
  pendingAck: { deliveryId: number; resolve: () => void } | null
  method: OrchestrationWsSubscribe['method']
  sessionId?: string
}

type OrchestrationStreamItem = OrchestrationShellStreamFrame | OrchestrationSessionStreamFrame

const SERVICE_RESTART_CLOSE_CODE = 1012
const SERVICE_RESTART_CLOSE_REASON = 'service restart'

export type OrchestrationSockets = ReturnType<typeof createOrchestrationSockets>

/** The open orchestration sockets, so a shutdown can announce itself before the listener stops. */
export function createOrchestrationSockets() {
  let closing = false
  const open = new Map<
    object,
    { socket: OrchestrationRpcWebSocket; state: OrchestrationRpcConnectionState }
  >()

  return {
    add(socket: OrchestrationRpcWebSocket, state: OrchestrationRpcConnectionState) {
      if (closing) {
        closeForRestart(socket, state)
        return false
      }
      open.set(socket.key, { socket, state })
      return true
    },
    delete(socket: OrchestrationRpcWebSocket) {
      open.delete(socket.key)
    },
    // 1012 is the registered "service restart"; a client logs the reconnect that follows at info.
    closeAll() {
      closing = true
      for (const { socket, state } of [...open.values()]) {
        closeForRestart(socket, state)
      }
    },
  }
}

function closeForRestart(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
) {
  state.serverCloseReason = SERVICE_RESTART_CLOSE_REASON
  socket.close(SERVICE_RESTART_CLOSE_CODE, SERVICE_RESTART_CLOSE_REASON)
}

export function orchestrationWsRoutes(
  engine: OrchestrationEngine,
  auth: AuthConfig,
  identity: EnvironmentIdentity,
  sockets: OrchestrationSockets,
  update: Pick<ServerUpdate, 'enabled' | 'state' | 'subscribe'>,
) {
  const states = new WeakMap<object, OrchestrationRpcConnectionState>()
  const config = orchestrationWsServerConfig(identity)

  return new Elysia({ name: 'orchestration-ws-rpc' }).ws('/orchestration/rpc', {
    body: orchestrationWsClientMessageSchema,
    open(ws) {
      const socket = adaptWebSocket(ws)
      if (!socket) return

      const log = connectionLogContext(socket.data)
      const authError = authenticateWebSocketData(socket.data, auth)
      if (authError) {
        recordChatPipelineWarning('chat.pipeline.ws.auth_failed', {
          ...log,
          errorCode: authError.code,
          status: authError.statusCode,
        })
        socket.close(1008, 'unauthorized')
        return
      }

      const state: OrchestrationRpcConnectionState = {
        log,
        nextDeliveryId: 1,
        openedAt: performance.now(),
        serverCloseReason: null,
        subscriptions: new Map(),
        unsubscribeUpdate: noop,
      }
      states.set(socket.key, state)
      if (!sockets.add(socket, state)) return
      // The handshake is pushed rather than requested so the client reaches an
      // honest `connected` phase — and can compare protocol versions — without
      // paying a round trip before it may subscribe.
      sendOrchestrationRpcMessage(socket, state, { config, kind: 'connected' })
      publishServerUpdate(socket, state, update)
      recordChatPipelineInfo('chat.pipeline.ws.open', {
        ...log,
        environmentId: config.environmentId,
        protocolVersion: config.protocolVersion,
        serverInstanceId: config.serverInstanceId,
        serverVersion: config.serverVersion,
      })
    },
    message(ws, message) {
      const socket = adaptWebSocket(ws)
      if (!socket) return

      const state = states.get(socket.key)
      if (!state) return

      handleOrchestrationRpcMessage(engine, socket, state, message, config)
    },
    close(ws, code, reason) {
      const socket = adaptWebSocket(ws)
      if (!socket) return

      const state = states.get(socket.key)
      const subscriptionCount = state?.subscriptions.size ?? 0
      state?.unsubscribeUpdate()
      if (state) closeOrchestrationRpcState(state)

      states.delete(socket.key)
      sockets.delete(socket)
      // A close the server chose logged its cause when it chose it.
      const abnormal = isAbnormalWebSocketClose(code) && !state?.serverCloseReason
      const record = abnormal ? recordChatPipelineWarning : recordChatPipelineInfo
      record('chat.pipeline.ws.close', {
        ...state?.log,
        code,
        durationMs: state ? Math.round(performance.now() - state.openedAt) : null,
        reason: reason || null,
        serverCloseReason: state?.serverCloseReason ?? null,
        subscriptionCount,
      })
    },
  })
}

function handleOrchestrationRpcMessage(
  engine: OrchestrationEngine,
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  message: OrchestrationWsClientMessage,
  config: OrchestrationWsServerConfig,
) {
  if (message.kind === 'subscription.ack') {
    const pending = state.subscriptions.get(message.subscriptionId)?.pendingAck
    if (pending?.deliveryId === message.deliveryId) pending.resolve()
    return
  }

  if (message.kind === 'request') {
    void handleOrchestrationRpcRequest(engine, socket, state, message, config)
    return
  }

  if (message.kind === 'subscribe') {
    handleOrchestrationRpcSubscribe(engine, socket, state, message)
    return
  }

  if (message.kind === 'unsubscribe') {
    unsubscribeOrchestrationRpcState(state, message.subscriptionId)
    return
  }

  sendOrchestrationRpcMessage(socket, state, {
    kind: 'pong',
    requestId: message.requestId,
  })
}

async function handleOrchestrationRpcRequest(
  engine: OrchestrationEngine,
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  message: OrchestrationWsRequest,
  config: OrchestrationWsServerConfig,
) {
  const startedAt = performance.now()
  const context = { ...state.log, ...orchestrationRpcRequestSummary(message) }
  recordChatPipelineInfo('chat.pipeline.ws.request.received', context)

  try {
    const data = await resolveOrchestrationRpcRequest(engine, message, config)
    sendOrchestrationRpcMessage(socket, state, {
      data,
      kind: 'response',
      ok: true,
      requestId: message.requestId,
    })
    recordChatPipelineInfo('chat.pipeline.ws.request.complete', {
      ...context,
      ...orchestrationRpcResultSummary(message, data),
      durationMs: elapsedMs(startedAt),
    })
  } catch (error) {
    sendOrchestrationRpcMessage(socket, state, {
      error: serializeOrchestrationRpcError(error),
      kind: 'response',
      ok: false,
      requestId: message.requestId,
    })
    recordChatPipelineWarning('chat.pipeline.ws.request.error', {
      ...context,
      durationMs: elapsedMs(startedAt),
      error,
    })
  }
}

/**
 * One handler per method, declared against the contract's result map. The
 * record is what makes each handler's return type checkable: inside an
 * `if (message.method === …)` chain the branch's type is whatever the engine
 * happens to return, and nothing compares it to the wire contract.
 */
type OrchestrationRpcHandlers = {
  [M in Exclude<OrchestrationWsRequest['method'], 'serverConfig'>]: (
    engine: OrchestrationEngine,
    message: OrchestrationWsRequestOf<M>,
  ) => OrchestrationWsResult<M> | Promise<OrchestrationWsResult<M>>
}

const orchestrationRpcHandlers: OrchestrationRpcHandlers = {
  dispatchCommand: (engine, message) => engine.dispatchClientCommand(message.command),
  replayEvents: (engine, message) => engine.replay(message.input),
  sessionDetailPage: (engine, message) => engine.sessionDetailPage(message.input),
}

function resolveOrchestrationRpcRequest(
  engine: OrchestrationEngine,
  message: OrchestrationWsRequest,
  config: OrchestrationWsServerConfig,
) {
  if (message.method === 'dispatchCommand') {
    return orchestrationRpcHandlers.dispatchCommand(engine, message)
  }
  if (message.method === 'serverConfig') {
    return config
  }
  if (message.method === 'sessionDetailPage') {
    return orchestrationRpcHandlers.sessionDetailPage(engine, message)
  }

  return orchestrationRpcHandlers.replayEvents(engine, message)
}

function handleOrchestrationRpcSubscribe(
  engine: OrchestrationEngine,
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  message: OrchestrationWsSubscribe,
) {
  unsubscribeOrchestrationRpcState(state, message.subscriptionId)

  const abortController = new AbortController()
  const subscription: OrchestrationRpcSubscription = {
    abortController,
    budget: new LiveStreamBudget(),
    pendingAck: null,
    method: message.method,
    sessionId: message.method === 'subscribeSession' ? message.sessionId : undefined,
  }
  state.subscriptions.set(message.subscriptionId, subscription)
  recordChatPipelineInfo('chat.pipeline.ws.subscription.start', {
    ...state.log,
    ...orchestrationRpcSubscribeSummary(message),
  })

  const stream = orchestrationRpcStream(
    engine,
    message,
    abortController.signal,
    subscription.budget,
  )
  void pumpOrchestrationRpcSubscription(socket, state, message.subscriptionId, stream, subscription)
}

async function pumpOrchestrationRpcSubscription(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  subscriptionId: OrchestrationWsSubscriptionId,
  stream: AsyncIterable<OrchestrationStreamItem>,
  subscription: OrchestrationRpcSubscription,
) {
  try {
    for await (const item of stream) {
      if (subscription.abortController.signal.aborted) break

      const deliveryId = state.nextDeliveryId++
      const acknowledgement = awaitSubscriptionAck(subscription, deliveryId)
      const sent = sendOrchestrationRpcMessage(socket, state, {
        item,
        kind: 'subscription.next',
        subscriptionId,
        deliveryId,
      })
      if (!sent) subscription.abortController.abort()
      await acknowledgement
    }
  } catch (error) {
    handleOrchestrationRpcSubscriptionError(socket, state, subscriptionId, subscription, error)
  } finally {
    subscription.budget.dispose()
    completeOrchestrationRpcSubscription(socket, state, subscriptionId, subscription)
  }
}

function handleOrchestrationRpcSubscriptionError(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  subscriptionId: OrchestrationWsSubscriptionId,
  subscription: OrchestrationRpcSubscription,
  error: unknown,
) {
  if (subscription.abortController.signal.aborted) return

  sendOrchestrationRpcMessage(socket, state, {
    error: serializeOrchestrationRpcError(error),
    kind: 'subscription.error',
    subscriptionId,
  })
  const ackTimedOut = isLiveStreamAckTimeout(error)
  const record = ackTimedOut ? recordChatPipelineInfo : recordChatPipelineWarning
  record('chat.pipeline.ws.subscription.error', {
    ...state.log,
    error,
    method: subscription.method,
    subscriptionId,
    sessionId: subscription.sessionId,
  })
  if (ackTimedOut) closeSilentPeer(socket, state)
}

// A peer that leaves a delivery unacknowledged for the whole timeout is gone.
// Its client resumes every subscription on a new socket.
function closeSilentPeer(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
) {
  if (state.serverCloseReason) return

  state.serverCloseReason = ACK_TIMEOUT_CLOSE_REASON
  socket.close(ACK_TIMEOUT_CLOSE_CODE, ACK_TIMEOUT_CLOSE_REASON)
}

function completeOrchestrationRpcSubscription(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  subscriptionId: OrchestrationWsSubscriptionId,
  subscription: OrchestrationRpcSubscription,
) {
  const current = state.subscriptions.get(subscriptionId)
  if (current !== subscription) return

  state.subscriptions.delete(subscriptionId)
  if (!subscription.abortController.signal.aborted) {
    sendOrchestrationRpcMessage(socket, state, {
      kind: 'subscription.complete',
      subscriptionId,
    })
  }
  recordChatPipelineInfo('chat.pipeline.ws.subscription.closed', {
    ...state.log,
    aborted: subscription.abortController.signal.aborted,
    method: subscription.method,
    subscriptionId,
    sessionId: subscription.sessionId,
  })
}

function orchestrationRpcStream(
  engine: OrchestrationEngine,
  message: OrchestrationWsSubscribe,
  signal: AbortSignal,
  budget: LiveStreamBudget,
) {
  if (message.method === 'subscribeShell') {
    return engine.shellStream({ afterSequence: message.afterSequence, signal, budget })
  }

  return engine.sessionDetailStream(message.sessionId, {
    afterSequence: message.afterSequence,
    signal,
    budget,
  })
}

function unsubscribeOrchestrationRpcState(
  state: OrchestrationRpcConnectionState,
  subscriptionId: OrchestrationWsSubscriptionId,
) {
  const subscription = state.subscriptions.get(subscriptionId)
  if (!subscription) return

  state.subscriptions.delete(subscriptionId)
  subscription.abortController.abort()
  subscription.budget.dispose()
  recordChatPipelineInfo('chat.pipeline.ws.subscription.unsubscribe', {
    ...state.log,
    method: subscription.method,
    subscriptionId,
    sessionId: subscription.sessionId,
  })
}

// A server without a production root has no update to announce, so its clients hear nothing.
function publishServerUpdate(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  update: Pick<ServerUpdate, 'enabled' | 'state' | 'subscribe'>,
) {
  if (!update.enabled) return

  sendOrchestrationRpcMessage(socket, state, { kind: 'server.update', update: update.state() })
  state.unsubscribeUpdate = update.subscribe((next) => {
    sendOrchestrationRpcMessage(socket, state, { kind: 'server.update', update: next })
  })
}

function closeOrchestrationRpcState(state: OrchestrationRpcConnectionState) {
  const subscriptions = [...state.subscriptions.keys()]

  for (const subscriptionId of subscriptions) {
    unsubscribeOrchestrationRpcState(state, subscriptionId)
  }
}

function sendOrchestrationRpcMessage(
  socket: OrchestrationRpcWebSocket,
  state: OrchestrationRpcConnectionState,
  message: OrchestrationWsServerMessage,
) {
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch (error) {
    recordChatPipelineWarning('chat.pipeline.ws.send_failed', {
      ...state.log,
      error,
      messageKind: message.kind,
    })
    socket.close()
    return false
  }
}

function orchestrationRpcRequestSummary(message: OrchestrationWsRequest) {
  if (message.method === 'dispatchCommand') return orchestrationCommandSummary(message.command)
  if (message.method === 'sessionDetailPage') {
    return {
      // Whether the walk started from a boundary is what tells a first page from
      // a continuation; the anchor ids themselves say nothing a reader needs.
      fromMessageAnchor: Boolean(message.input.beforeMessage),
      fromActivityAnchor: Boolean(message.input.beforeActivity),
      limit: message.input.limit,
      method: message.method,
      sessionId: message.input.sessionId,
    }
  }
  if (message.method === 'replayEvents') {
    return {
      method: message.method,
      ...orchestrationReplaySummary(message.input),
    }
  }

  return { method: message.method }
}

/**
 * Folded into the one request event rather than emitted as a second line: what
 * a page read is worth knowing about is how much came back and whether the walk
 * reached the start of the session.
 */
function orchestrationRpcResultSummary(message: OrchestrationWsRequest, data: unknown) {
  if (message.method !== 'sessionDetailPage') return {}

  const page = data as OrchestrationSessionDetailPage

  return {
    activityCount: page.activities.length,
    hasEarlier: page.hasEarlier,
    messageCount: page.messages.length,
  }
}

function orchestrationRpcSubscribeSummary(message: OrchestrationWsSubscribe) {
  if (message.method === 'subscribeSession') {
    return {
      afterSequence: message.afterSequence,
      method: message.method,
      subscriptionId: message.subscriptionId,
      sessionId: message.sessionId,
    }
  }

  return {
    afterSequence: message.afterSequence,
    method: message.method,
    subscriptionId: message.subscriptionId,
  }
}

function awaitSubscriptionAck(subscription: OrchestrationRpcSubscription, deliveryId: number) {
  const signal = AbortSignal.any([subscription.abortController.signal, subscription.budget.signal])
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      subscription.pendingAck = null
      if (error === undefined) {
        resolve()
        return
      }

      reject(error)
    }
    const abort = () => finish(signal.reason)
    const timer = setTimeout(
      () => subscription.budget.ackTimeout({ deliveryId, timeoutMs: ACK_TIMEOUT_MS }),
      ACK_TIMEOUT_MS,
    )
    subscription.pendingAck = { deliveryId, resolve: () => finish() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/**
 * Subscription ids are numbered per client, so the instance id is what tells two
 * clients' events apart. Browsers cannot set socket headers; they send the query param.
 */
function connectionLogContext(data: unknown): ConnectionLogContext {
  const instanceId = clientInstanceId(data)

  return instanceId ? { client: { instanceId } } : {}
}

function clientInstanceId(data: unknown) {
  if (!isRecord(data)) return null
  const query = isRecord(data.query) ? data.query.instance : undefined
  const header = isRecord(data.headers) ? data.headers['x-client-instance'] : undefined
  const value = typeof query === 'string' ? query : header
  if (typeof value !== 'string') return null

  return value.trim().slice(0, 64) || null
}

function noop() {}
